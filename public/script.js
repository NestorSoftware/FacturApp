let procesando = false;
let facturasReg = [];
let costeTotal = 0;
const COSTE_TEXTO  = 0.0001;
const COSTE_VISION = 0.003;

function actualizarCoste(resultados) {
  resultados.forEach(r => { costeTotal += r.usoVision ? COSTE_VISION : COSTE_TEXTO; });
  document.getElementById("coste-sesion").style.display = "inline";
  document.getElementById("coste-valor").textContent = costeTotal.toFixed(4);
}

if (window.electronAPI) {
  window.electronAPI.getGroqKey().then(key => { if (!key) mostrarConfig(); });
}
function mostrarConfig() { document.getElementById("config-panel").style.display = "flex"; }
function ocultarConfig() { document.getElementById("config-panel").style.display = "none"; }
async function guardarKey() {
  const openaiKey = document.getElementById("openai-input").value.trim();
  const groqKey   = document.getElementById("groq-input").value.trim();
  if (!openaiKey && !groqKey) { setConfigMsg("#ef4444","Introduce al menos una API key"); return; }
  if (openaiKey && !openaiKey.startsWith("sk-")) { setConfigMsg("#ef4444","OpenAI key inválida"); return; }
  if (groqKey && !groqKey.startsWith("gsk_")) { setConfigMsg("#ef4444","Groq key inválida"); return; }
  if (window.electronAPI) {
    await window.electronAPI.guardarKey({ openaiKey, groqKey });
    setConfigMsg("#22c55e","✓ Guardado correctamente");
    setTimeout(ocultarConfig, 1000);
  } else {
    setConfigMsg("#f59e0b","Edita el .env manualmente");
  }
}
function setConfigMsg(color, txt) {
  const el = document.getElementById("config-msg");
  el.style.color = color; el.textContent = txt;
}

function cambiarTab(tab) {
  document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
  document.querySelector(`[onclick="cambiarTab('${tab}')"]`).classList.add("active");
  document.getElementById("section-" + tab).classList.add("active");
}

(async () => {
  await checkStatus();
  await cargarInput();
  await cargarOutput();
  await cargarRevisar();
  await cargarDescartadas();
  setInterval(cargarInput, 5000);
  initDropZone();
  initDropZoneReg();
})();

async function checkStatus() {
  try {
    const r = await fetch("/api/status");
    const dot = document.getElementById("status-dot");
    const txt = document.getElementById("status-text");
    if (r.ok) { dot.className = "dot online"; txt.textContent = "servidor activo"; }
    else throw new Error();
  } catch {
    document.getElementById("status-dot").className = "dot offline";
    document.getElementById("status-text").textContent = "sin conexión";
  }
}

async function refrescar() {
  await cargarInput(); await cargarOutput();
  await cargarRevisar(); await cargarDescartadas();
}

async function cargarInput() {
  if (procesando) return;
  try {
    const data = await fetch("/api/input").then(r => r.json());
    renderInput(data.archivos || []);
  } catch (_) {}
}

function renderInput(archivos) {
  const lista = document.getElementById("input-list");
  const count = document.getElementById("input-count");
  const btn   = document.getElementById("btn-procesar");
  count.textContent = archivos.length ? `${archivos.length} archivo${archivos.length > 1 ? "s" : ""}` : "vacío";
  btn.disabled = procesando || archivos.length === 0;
  lista.innerHTML = archivos.length === 0
    ? `<div class="empty"><div class="empty-icon">📂</div><p>Copia los archivos en <code>input/</code><br/>y pulsa Procesar.</p></div>`
    : archivos.map(f => `<div class="file-item"><span class="file-badge ${badgeClass(f.tipo)}">${f.tipo}</span><span class="fi-name">${esc(f.nombre)}</span><span class="fi-size">${fmtBytes(f.tamanyo)}</span></div>`).join("");
}

async function cargarOutput() {
  try {
    const data = await fetch("/api/output").then(r => r.json());
    const archivos = data.archivos || [];
    document.getElementById("output-count").textContent = archivos.length ? `${archivos.length} procesado${archivos.length > 1 ? "s" : ""}` : "vacío";
    document.getElementById("output-list").innerHTML = archivos.length === 0
      ? `<div class="empty"><div class="empty-icon">✅</div><p>Facturas procesadas<br/>aparecerán aquí.</p></div>`
      : archivos.map(f => `<div class="file-item"><span class="fi-check">✓</span><span class="fi-name" title="${esc(f.nombre)}">${esc(f.nombre)}</span><span class="fi-size">${fmtBytes(f.tamanyo)}</span></div>`).join("");
  } catch (_) {}
}

async function cargarRevisar() {
  try {
    const data = await fetch("/api/revisar").then(r => r.json());
    const archivos = data.archivos || [];
    document.getElementById("revisar-count").textContent = archivos.length ? `${archivos.length} archivo${archivos.length > 1 ? "s" : ""}` : "vacío";
    document.getElementById("revisar-list").innerHTML = archivos.length === 0
      ? `<div class="empty"><div class="empty-icon">🔍</div><p>Facturas dudosas<br/>para revisión manual.</p></div>`
      : archivos.map(f => `<div class="file-item"><span class="fi-warn">⚠</span><span class="fi-name" title="${esc(f.nombre)}">${esc(f.nombre)}</span><span class="fi-size">${fmtBytes(f.tamanyo)}</span></div>`).join("");
  } catch (_) {}
}

async function cargarDescartadas() {
  try {
    const data = await fetch("/api/descartadas").then(r => r.json());
    const archivos = data.archivos || [];
    document.getElementById("descartadas-count").textContent = archivos.length ? `${archivos.length} archivo${archivos.length > 1 ? "s" : ""}` : "vacío";
    document.getElementById("descartadas-list").innerHTML = archivos.length === 0
      ? `<div class="empty"><div class="empty-icon">🗂</div><p>Documentos no válidos<br/>aparecerán aquí.</p></div>`
      : archivos.map(f => `<div class="file-item"><span class="file-badge ${badgeClass(f.tipo)}">${f.tipo}</span><span class="fi-name" title="${esc(f.nombre)}">${esc(f.nombre)}</span><span class="fi-size">${fmtBytes(f.tamanyo)}</span></div>`).join("");
  } catch (_) {}
}

function initDropZone() {
  const zone     = document.getElementById("drop-zone");
  const input    = document.getElementById("file-input");
  const feedback = document.getElementById("upload-feedback");
  const subirArchivos = async (files) => {
    if (!files?.length) return;
    const fd = new FormData();
    Array.from(files).forEach(f => fd.append("archivos", f));
    feedback.style.display = "block";
    feedback.style.color = "var(--text-dim)";
    feedback.textContent = `Subiendo ${files.length} archivo${files.length > 1 ? "s" : ""}...`;
    try {
      const resp = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await resp.json();
      if (data.ok) { feedback.style.color = "var(--ok)"; feedback.textContent = `✓ ${data.total} subido${data.total > 1 ? "s" : ""}`; await cargarInput(); }
      else { feedback.style.color = "var(--err)"; feedback.textContent = "✗ " + (data.error || "Error"); }
    } catch { feedback.style.color = "var(--err)"; feedback.textContent = "✗ Error de red"; }
    setTimeout(() => { feedback.style.display = "none"; }, 3000);
  };
  input.addEventListener("change", () => subirArchivos(input.files));
  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", e => { e.preventDefault(); zone.classList.remove("drag-over"); subirArchivos(e.dataTransfer.files); });
}

document.getElementById("btn-procesar").addEventListener("click", async () => {
  if (procesando) return;
  procesando = true;
  const btn      = document.getElementById("btn-procesar");
  const progWrap = document.getElementById("progress-wrap");
  const fill     = document.getElementById("prog-fill");
  const label    = document.getElementById("prog-label");
  const resPan   = document.getElementById("results-panel");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>Procesando...`;
  progWrap.style.display = "flex";
  fill.style.width = "5%";
  label.textContent = "Enviando a la IA...";
  let pct = 5;
  const iv = setInterval(() => { pct = Math.min(pct + 0.6, 88); fill.style.width = pct + "%"; }, 400);
  try {
    const resp = await fetch("/api/procesar", { method: "POST" });
    const data = await resp.json();
    clearInterval(iv);
    fill.style.width = "100%";
    if (!data.ok) {
      label.textContent = "Error: " + (data.error || "desconocido");
    } else {
      label.textContent = `✓ ${data.facturas} output — ${data.revision} revisar — ${data.noFacturas} descartadas — ${data.errores} errores`;
      resPan.style.display = "block";
      mostrarResultados(data);
    }
    await cargarOutput(); await cargarInput();
    await cargarRevisar(); await cargarDescartadas();
  } catch (e) {
    clearInterval(iv);
    label.textContent = "Error de red: " + e.message;
  }
  procesando = false;
  btn.disabled = false;
  btn.textContent = "Procesar facturas";
  setTimeout(() => { progWrap.style.display = "none"; fill.style.width = "0%"; }, 4000);
});

function mostrarResultados(data) {
  document.getElementById("stat-total").textContent = data.total;
  document.getElementById("stat-ok").textContent    = data.facturas;
  document.getElementById("stat-rev").textContent   = data.revision;
  document.getElementById("stat-no").textContent    = data.noFacturas;
  document.getElementById("stat-err").textContent   = data.errores;

  document.getElementById("result-area").innerHTML = data.resultados.map(r => {
    let statusCls, statusTxt;
    if (!r.ok && r.error)       { statusCls = "err";    statusTxt = "ERROR"; }
    else if (!r.ok)             { statusCls = "warn";   statusTxt = "DESCARTADO"; }
    else if (r.enRevision)      { statusCls = "review"; statusTxt = "REVISAR"; }
    else                        { statusCls = "ok";     statusTxt = "FACTURA"; }

    let body = "";
    if (r.ok) {
      body = `
        ${r.enRevision ? `<div class="rc-review-note">⚠ Proveedor detectado como propio — revisar manualmente en carpeta <strong>revisar/</strong></div>` : ""}
        <div class="rc-output-label">Nombre generado</div>
        <div class="rc-output-name ${r.enRevision ? "review" : ""}">${esc(r.nombre)}</div>
        <div class="rc-fields">
          <div class="rc-field"><div class="rc-field-label">Proveedor</div><div class="rc-field-value">${esc(r.datos.proveedor)}</div></div>
          <div class="rc-field"><div class="rc-field-label">Nº Factura</div><div class="rc-field-value">${esc(r.datos.numero_factura)}</div></div>
          <div class="rc-field"><div class="rc-field-label">Fecha</div><div class="rc-field-value">${esc(r.datos.fecha)}</div></div>
          <div class="rc-field"><div class="rc-field-label">Total</div><div class="rc-field-value">${esc(r.datos.total)} €</div></div>
        </div>`;
    } else {
      body = `<div class="rc-error">${esc(r.motivo || r.error || "Error desconocido")}</div>`;
    }
    return `
      <div class="result-card ${r.enRevision ? "en-revision" : ""}">
        <div class="rc-header">
          <span class="badge-status ${statusCls}">${statusTxt}</span>
          <span class="rc-tipo">${esc(r.tipo || "?")}</span>
          <span class="rc-orig">${esc(r.nombreOriginal)}</span>
          <span class="rc-ms">${r.ms} ms</span>
        </div>
        <div class="rc-body">${body}${renderLog(r.log)}</div>
      </div>`;
  }).join("");
  actualizarCoste(data.resultados);
}

function renderLog(log) {
  if (!log?.length) return "";
  const lines = log.map(l => {
    let cls = "log-line";
    if (l.includes("OK")) cls = "log-ok";
    else if (l.includes("ERROR") || l.includes("error")) cls = "log-err";
    return `<div class="${cls}">${esc(l)}</div>`;
  }).join("");
  return `<div class="log-wrap"><button class="log-toggle" onclick="toggleLog(this)">▶ log (${log.length} líneas)</button><div class="log-content">${lines}</div></div>`;
}

// ── Registro Excel ────────────────────────────────────────────────
function parsearNombre(nombre) {
  const base = nombre.replace(/\.pdf$/i, "");
  const partes = base.split("_");
  if (partes.length < 4) return null;
  const total     = partes[partes.length - 1];
  const fecha     = partes[partes.length - 2];
  const numero    = partes[partes.length - 3];
  const proveedor = partes.slice(0, partes.length - 3).join("_");
  return { proveedor, numero_factura: numero, fecha, total: parseFloat(total.replace(",", ".")) || 0, nombre_fichero: nombre, cif: null, cifCoincide: null };
}

function initDropZoneReg() {
  const zone  = document.getElementById("drop-zone-reg");
  const input = document.getElementById("file-input-reg");
  const procesar = async (files) => {
    if (!files?.length) return;
    const pdfs = Array.from(files).filter(f => f.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) { mostrarMsg("msg-carga-reg", "err", "No se encontraron PDFs"); return; }
    const facturasParsed = pdfs.map(f => parsearNombre(f.name)).filter(Boolean);
    const omitidos = pdfs.length - facturasParsed.length;
    const total = facturasParsed.reduce((s, f) => s + f.total, 0);
    facturasReg = facturasParsed;
    renderTablaReg(facturasParsed, total);
    mostrarMsg("msg-carga-reg", "ok", `<span class="spinner"></span> Verificando CIFs...`);
    const pdfsValidos = pdfs.filter(f => parsearNombre(f.name));
    await Promise.all(pdfsValidos.map(async (file, i) => {
      try {
        const base64 = await new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(",")[1]);
          reader.readAsDataURL(file);
        });
        const resp = await fetch("/api/verificar-cif", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nombre: file.name, base64 }) });
        const data = await resp.json();
        facturasReg[i].cif = data.cif || "";
        facturasReg[i].cifCoincide = data.coincide;
      } catch {
        facturasReg[i].cif = ""; facturasReg[i].cifCoincide = false;
      }
      actualizarFilaCIF(i, facturasReg[i]);
    }));
    const cifErroneos = facturasReg.filter(f => f.cif && !f.cifCoincide).length;
    let msg = `✓ ${facturasParsed.length} factura${facturasParsed.length !== 1 ? "s" : ""} verificadas`;
    if (omitidos > 0) msg += ` — ${omitidos} omitidas`;
    if (cifErroneos > 0) msg += ` — ⚠ ${cifErroneos} con CIF diferente`;
    mostrarMsg("msg-carga-reg", cifErroneos > 0 ? "err" : "ok", msg);
    actualizarStatsReg(facturasReg);
  };
  input.addEventListener("change", () => procesar(input.files));
  zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
  zone.addEventListener("drop", e => { e.preventDefault(); zone.classList.remove("drag-over"); procesar(e.dataTransfer.files); });
}

function renderTablaReg(facturas, total) {
  document.getElementById("panel-tabla-reg").style.display = "block";
  document.getElementById("msg-exportar").style.display = "none";
  document.getElementById("anadir-wrap").style.display = "none";
  document.getElementById("tabla-count-reg").textContent = `${facturas.length} factura${facturas.length !== 1 ? "s" : ""}`;
  actualizarStatsReg(facturas);
  document.getElementById("tabla-body-reg").innerHTML = facturas.length === 0
    ? `<tr><td colspan="6"><div class="empty"><div class="empty-icon">📂</div><p>Sin facturas válidas.</p></div></td></tr>`
    : facturas.map((f, i) => `
        <tr id="fila-reg-${i}">
          <td>${esc(f.proveedor)}</td><td>${esc(f.numero_factura)}</td><td>${esc(f.fecha)}</td>
          <td class="num">${f.total.toLocaleString("es-ES", {minimumFractionDigits:2})} €</td>
          <td class="cif-spin" id="cif-reg-${i}"><span class="spinner"></span></td>
          <td class="dim">${esc(f.nombre_fichero)}</td>
        </tr>`).join("");
  document.getElementById("tabla-foot-reg").innerHTML = `
    <tr><td colspan="3"><strong>TOTAL</strong></td>
    <td class="num"><strong>${total.toLocaleString("es-ES", {minimumFractionDigits:2})} €</strong></td>
    <td colspan="2"></td></tr>`;
}

function actualizarFilaCIF(i, factura) {
  const cell = document.getElementById(`cif-reg-${i}`);
  if (!cell) return;
  if (!factura.cif) { cell.className = "dim"; cell.textContent = "—"; }
  else if (factura.cifCoincide) { cell.className = "cif-ok"; cell.textContent = factura.cif; }
  else { cell.className = "cif-err"; cell.textContent = factura.cif + " ⚠"; }
}

function actualizarStatsReg(facturas) {
  const total = facturas.reduce((s, f) => s + f.total, 0);
  const proveedores = [...new Set(facturas.map(f => f.proveedor))].length;
  const cifErroneos = facturas.filter(f => f.cif && !f.cifCoincide).length;
  document.getElementById("stats-row-reg").innerHTML = `
    <div class="stat-box"><div class="stat-val ok">${facturas.length}</div><div class="stat-lbl">Facturas</div></div>
    <div class="stat-box"><div class="stat-val accent">${total.toLocaleString("es-ES", {minimumFractionDigits:2})} €</div><div class="stat-lbl">Total</div></div>
    <div class="stat-box"><div class="stat-val">${proveedores}</div><div class="stat-lbl">Proveedores</div></div>
    ${cifErroneos > 0 ? `<div class="stat-box"><div class="stat-val err">${cifErroneos}</div><div class="stat-lbl">CIF diferente</div></div>` : ""}`;
}

async function exportarNuevo() {
  if (!facturasReg.length) return;
  mostrarMsg("msg-exportar", "ok", '<span class="spinner"></span> Generando Excel...');
  try {
    const resp = await fetch("/api/exportar-nuevo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ facturas: facturasReg }) });
    const data = await resp.json();
    if (data.ok) mostrarMsg("msg-exportar", "ok", "✓ Excel generado en: " + data.ruta);
    else mostrarMsg("msg-exportar", "err", data.error);
  } catch (e) { mostrarMsg("msg-exportar", "err", "Error: " + e.message); }
}

function toggleAnadir() {
  const wrap = document.getElementById("anadir-wrap");
  wrap.style.display = wrap.style.display === "none" ? "block" : "none";
}

async function exportarAnadir() {
  const rutaExcel = document.getElementById("excel-path").value.trim();
  if (!rutaExcel) return mostrarMsg("msg-exportar", "err", "Introduce la ruta del Excel");
  if (!facturasReg.length) return;
  mostrarMsg("msg-exportar", "ok", '<span class="spinner"></span> Añadiendo...');
  try {
    const resp = await fetch("/api/exportar-anadir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ facturas: facturasReg, rutaExcel }) });
    const data = await resp.json();
    if (data.ok) mostrarMsg("msg-exportar", "ok", "✓ Datos añadidos a: " + data.ruta);
    else mostrarMsg("msg-exportar", "err", data.error);
  } catch (e) { mostrarMsg("msg-exportar", "err", "Error: " + e.message); }
}

window.toggleLog = (btn) => {
  const c = btn.nextElementSibling;
  const open = c.style.display === "block";
  c.style.display = open ? "none" : "block";
  btn.textContent = (open ? "▶" : "▼") + btn.textContent.slice(1);
};

function mostrarMsg(id, tipo, texto) {
  const el = document.getElementById(id);
  el.className = "msg " + tipo; el.innerHTML = texto; el.style.display = "block";
}
function badgeClass(tipo) {
  return { pdf:"badge-pdf", word:"badge-word", excel:"badge-excel", imagen:"badge-img" }[tipo] || "badge-pdf";
}
function fmtBytes(b) {
  if (!b) return "";
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b/1024).toFixed(1) + " KB";
  return (b/1048576).toFixed(1) + " MB";
}
function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
