const appGrid = document.querySelector("#app-grid");
const emptyState = document.querySelector("#empty-state");
const noResults = document.querySelector("#no-results");
const dialog = document.querySelector("#app-dialog");
const form = document.querySelector("#app-form");
const formError = document.querySelector("#form-error");
const toast = document.querySelector("#toast");
const refreshButton = document.querySelector("#refresh-button");
const searchInput = document.querySelector("#search-input");
const sortButton = document.querySelector("#sort-button");
const appsById = new Map();
let applications = [];
let sortAscending = true;
let toastTimeout;
let editingAppId = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "La requête a échoué.");
  return result;
}

function formatTime(value) {
  if (!value) return "En attente";
  const date = new Date(value);
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function friendlyHost(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function appLogo(app) {
  if (app.favicon) {
    return `<span class="app-logo"><img class="app-favicon" src="${escapeHtml(app.favicon)}" alt=""></span>`;
  }
  const isVercel = app.url.toLowerCase().includes("vercel.app");
  return isVercel
    ? '<span class="app-logo vercel" aria-label="Vercel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 23 22H1L12 3Z"></path></svg></span>'
    : `<span class="app-logo">${escapeHtml(app.name.slice(0, 1))}</span>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function statusDetails(app) {
  if (!app.check) return { text: "En attente", className: "pending" };
  if (app.check.status === "online") return { text: "En ligne", className: "online" };
  if (app.check.status === "error") return { text: "Erreur HTTP", className: "error" };
  return { text: "Hors ligne", className: "offline" };
}

function vercelStatusDetails(vercel) {
  if (!vercel) return null;
  const states = {
    READY: ["Production prête", "online"],
    BUILDING: ["Build en cours", "checking"],
    INITIALIZING: ["Initialisation", "checking"],
    QUEUED: ["En attente de build", "checking"],
    ERROR: ["Échec du déploiement", "offline"],
    CANCELED: ["Déploiement annulé", "offline"],
    BLOCKED: ["Déploiement bloqué", "offline"],
    UNKNOWN: ["État Vercel inconnu", "pending"],
    NONE: ["Aucun déploiement de production", "pending"],
    UNCONFIGURED: ["Jeton Vercel non configuré", "pending"],
    API_ERROR: ["API Vercel inaccessible", "error"],
  };
  const [text, className] = states[vercel.status.toUpperCase()] || states.UNKNOWN;
  return { text, className, message: vercel.message || null };
}

function renderCard(app) {
  const status = statusDetails(app);
  const vercel = app.vercelProjectId ? vercelStatusDetails(app.vercel) : null;
  const check = app.check;
  const codeText = check?.code ? `HTTP ${check.code}` : check?.error || "Pas encore vérifiée";
  const latency = check?.latency !== null && check?.latency !== undefined ? `${check.latency} ms` : "—";
  const card = document.createElement("article");
  card.className = `app-card${status.className === "offline" || status.className === "error" ? " error-card" : ""}`;
  card.dataset.id = app.id;
  card.innerHTML = `
    <div class="app-card-top">
      <div class="app-identity">
        ${appLogo(app)}
        <div class="app-name-wrap">
          <h3 class="app-name" title="${escapeHtml(app.name)}">${escapeHtml(app.name)}</h3>
          <a class="app-url" href="${escapeHtml(app.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(app.url)}">${escapeHtml(friendlyHost(app.url))} <span aria-hidden="true">↗</span></a>
        </div>
      </div>
      <div class="menu-wrap">
        <button class="card-menu-button" type="button" aria-label="Options pour ${escapeHtml(app.name)}">···</button>
        <div class="menu-popover" hidden>
          <button type="button" data-configure="${escapeHtml(app.id)}">${app.vercelProjectId ? "Modifier Vercel" : "Configurer Vercel"}</button>
          <button type="button" data-delete="${escapeHtml(app.id)}">Supprimer</button>
        </div>
      </div>
    </div>
    <div class="app-status-row">
      <span class="status-pill ${status.className}">${status.text}</span>
      <span class="http-label">${escapeHtml(codeText)}</span>
    </div>
    <div class="app-details">
      <div><span class="detail-label">TEMPS DE RÉPONSE</span><span class="detail-value latency">${escapeHtml(latency)}</span></div>
      <div><span class="detail-label">DERNIÈRE VÉRIFICATION</span><span class="detail-value">${escapeHtml(formatTime(check?.checkedAt))}</span></div>
    </div>
    ${vercel ? `
      <div class="vercel-details">
        <div><span class="detail-label">DÉPLOIEMENT VERCEL</span><span class="status-pill ${vercel.className}">${escapeHtml(vercel.text)}</span></div>
        <div><span class="detail-label">${vercel.message ? "INFORMATION" : "DERNIER DÉPLOIEMENT"}</span><span class="detail-value">${vercel.message ? escapeHtml(vercel.message) : escapeHtml(formatTime(app.vercel?.createdAt))}</span></div>
        ${app.vercel?.inspectorUrl ? `<a class="vercel-inspector" href="${escapeHtml(app.vercel.inspectorUrl)}" target="_blank" rel="noopener noreferrer">Voir dans Vercel ↗</a>` : ""}
      </div>` : ""}`;
  const favicon = card.querySelector(".app-favicon");
  if (favicon) {
    favicon.addEventListener("error", () => {
      const logo = favicon.parentElement;
      favicon.remove();
      logo.textContent = app.name.slice(0, 1);
    }, { once: true });
  }
  return card;
}

function updateSummary() {
  const onlineCount = applications.filter((app) => app.check?.status === "online").length;
  const incidentCount = applications.filter((app) => app.check?.status === "offline" || app.check?.status === "error").length;
  const checks = applications.map((app) => app.check?.checkedAt).filter(Boolean).sort();
  document.querySelector("#total-count").textContent = applications.length;
  document.querySelector("#online-count").innerHTML = `${onlineCount}<span class="value-unit">/ ${applications.length}</span>`;
  document.querySelector("#incident-count").textContent = incidentCount;
  document.querySelector("#last-check").textContent = checks.length ? formatTime(checks[checks.length - 1]) : "—";
  document.querySelector("#nav-count").textContent = applications.length;
  document.querySelector("#section-count").textContent = applications.length;
  const onlineSummary = document.querySelector("#online-summary");
  if (applications.length === 0) {
    onlineSummary.textContent = "Aucune application ajoutée";
  } else if (onlineCount === applications.length) {
    onlineSummary.textContent = "Tout est opérationnel";
  } else if (incidentCount > 0) {
    onlineSummary.textContent = `${incidentCount} application${incidentCount > 1 ? "s" : ""} à vérifier`;
  } else {
    onlineSummary.textContent = "Vérifications en cours";
  }
}

function renderApps() {
  const query = searchInput.value.trim().toLocaleLowerCase("fr");
  const filtered = applications
    .filter((app) => `${app.name} ${app.url}`.toLocaleLowerCase("fr").includes(query))
    .sort((a, b) => a.name.localeCompare(b.name, "fr") * (sortAscending ? 1 : -1));
  appGrid.replaceChildren(...filtered.map(renderCard));
  emptyState.hidden = applications.length !== 0;
  noResults.hidden = applications.length === 0 || filtered.length !== 0;
  appGrid.hidden = filtered.length === 0;
  updateSummary();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 3200);
}

function setApps(items) {
  applications = items;
  appsById.clear();
  for (const app of items) appsById.set(app.id, app);
  renderApps();
}

async function loadApps() {
  const result = await api("/api/apps");
  document.body.classList.toggle("vercel-configured", result.vercelConfigured);
  setApps(result.apps);
}

async function checkApps(showMessage = false) {
  if (refreshButton.classList.contains("is-loading")) return;
  refreshButton.classList.add("is-loading");
  try {
    const result = await api("/api/check", { method: "POST" });
    document.body.classList.toggle("vercel-configured", result.vercelConfigured);
    setApps(result.apps);
    if (showMessage) showToast("Les statuts ont été actualisés.");
  } catch (error) {
    if (showMessage) showToast(error.message);
  } finally {
    refreshButton.classList.remove("is-loading");
  }
}

function openDialog(app = null) {
  editingAppId = app?.id || null;
  form.reset();
  document.querySelector("#app-name").value = app?.name || "";
  document.querySelector("#app-url").value = app?.url || "";
  document.querySelector("#health-path").value = app?.healthPath || "/";
  document.querySelector("#vercel-project").value = app?.vercelProjectId || "";
  document.querySelector("#dialog-title").textContent = app ? "Configurer Vercel" : "On l'ajoute ?";
  document.querySelector(".dialog-heading p").textContent = app
    ? "Renseigne l'ID ou le nom du projet Vercel à suivre pour cette application."
    : "Renseigne l'adresse publique de ton application pour commencer à la surveiller.";
  document.querySelector("#submit-button").innerHTML = app
    ? "Enregistrer le projet <span aria-hidden=\"true\">→</span>"
    : "Ajouter l'application <span aria-hidden=\"true\">→</span>";
  formError.hidden = true;
  formError.textContent = "";
  dialog.showModal();
  document.querySelector("#app-name").focus();
}

document.querySelector("#add-button").addEventListener("click", openDialog);
document.querySelector("#empty-add-button").addEventListener("click", openDialog);
document.querySelector("#close-dialog").addEventListener("click", () => dialog.close());
document.querySelector("#cancel-dialog").addEventListener("click", () => dialog.close());
refreshButton.addEventListener("click", () => checkApps(true));
searchInput.addEventListener("input", renderApps);
sortButton.addEventListener("click", () => {
  sortAscending = !sortAscending;
  sortButton.innerHTML = `${sortAscending ? "Nom" : "Nom Z–A"} <span aria-hidden="true">⌄</span>`;
  renderApps();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.hidden = true;
  const submitButton = document.querySelector("#submit-button");
  submitButton.disabled = true;
  try {
    const body = Object.fromEntries(new FormData(form));
    const result = editingAppId
      ? await api(`/api/apps/${encodeURIComponent(editingAppId)}`, {
        method: "PATCH",
        body: JSON.stringify({ vercelProjectId: body.vercelProjectId }),
      })
      : await api("/api/apps", { method: "POST", body: JSON.stringify(body) });
    document.body.classList.toggle("vercel-configured", result.vercelConfigured);
    if (editingAppId) {
      setApps(applications.map((app) => app.id === editingAppId ? result.app : app));
    } else {
      setApps([...applications, result.app]);
    }
    dialog.close();
    showToast(editingAppId ? "Projet Vercel mis à jour." : `${result.app.name} a été ajoutée à ton espace.`);
    void checkApps();
  } catch (error) {
    formError.textContent = error.message;
    formError.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
});

appGrid.addEventListener("click", async (event) => {
  const menuButton = event.target.closest(".card-menu-button");
  if (menuButton) {
    const menu = menuButton.nextElementSibling;
    document.querySelectorAll(".menu-popover").forEach((item) => {
      if (item !== menu) item.hidden = true;
    });
    menu.hidden = !menu.hidden;
    return;
  }
  const configureButton = event.target.closest("[data-configure]");
  if (configureButton) {
    const app = appsById.get(configureButton.dataset.configure);
    if (app) openDialog(app);
    return;
  }
  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton) {
    const app = appsById.get(deleteButton.dataset.delete);
    if (!app || !window.confirm(`Supprimer « ${app.name} » de ton tableau de bord ?`)) return;
    try {
      await api(`/api/apps/${encodeURIComponent(app.id)}`, { method: "DELETE" });
      setApps(applications.filter((item) => item.id !== app.id));
      showToast(`${app.name} a été supprimée.`);
    } catch (error) {
      showToast(error.message);
    }
    return;
  }
  document.querySelectorAll(".menu-popover").forEach((item) => { item.hidden = true; });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".menu-wrap")) {
    document.querySelectorAll(".menu-popover").forEach((item) => { item.hidden = true; });
  }
});

loadApps()
  .then(() => checkApps())
  .catch((error) => showToast(`Impossible de charger les applications : ${error.message}`));

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((error) => {
    console.error("Impossible d'enregistrer le service worker Orbit :", error);
  });
}

setInterval(() => {
  if (!document.hidden) void checkApps();
}, 60_000);
