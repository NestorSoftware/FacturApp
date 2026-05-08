const os     = require("os");
const path   = require("path");
const dotenv = require("dotenv");

const BASE_DIR = process.env.APP_BASE_DIR || __dirname;
dotenv.config({ path: path.join(BASE_DIR, ".env") });

const express  = require("express");
const fs       = require("fs");
const FormData = require("form-data");
const pdfParse = require("pdf-parse");
const multer   = require("multer");
const ExcelJS  = require("exceljs");

const app  = express();
const PORT = process.env.PORT || 3005;

const OPENAI_KEY    = process.env.OPENAI_API_KEY;
const GROQ          = process.env.GROQ_API_KEY;
const GOTENBERG_URL = (process.env.GOTENBERG_URL || "http://localhost:3000") + "/forms/libreoffice/convert";

// ── CONFIGURACIÓN DE EMPRESA (todo desde .env) ────────────────────
const CIF_EMPRESA = process.env.CIF_EMPRESA || "";

// Nombres propios: cadena separada por comas en .env
// Ejemplo: PROVEEDORES_PROPIOS=miempresa,miotranombre,marcacomercial
const PROVEEDORES_PROPIOS = (process.env.PROVEEDORES_PROPIOS || "")
  .split(",")
  .map(p => p.trim().toLowerCase())
  .filter(Boolean);

// Nombres legibles para el prompt (ej: "MI EMPRESA SL, OTRA MARCA")
const NOMBRE_EMPRESA_PROMPT   = process.env.NOMBRE_EMPRESA_PROMPT   || "MI EMPRESA";
const NOMBRE_EMPRESA_2_PROMPT = process.env.NOMBRE_EMPRESA_2_PROMPT || "";

// ─────────────────────────────────────────────────────────────────

const INPUT_DIR  = path.join(BASE_DIR, "input");
const OUTPUT_DIR = path.join(BASE_DIR, "output");
const TRASH_DIR  = path.join(BASE_DIR, "descartadas");
const REVIEW_DIR = path.join(BASE_DIR, "revisar");
const EXCEL_DIR  = path.join(BASE_DIR, "ArchivosExcel");
const ERROR_DIR  = path.join(BASE_DIR, "errores");

[INPUT_DIR, OUTPUT_DIR, TRASH_DIR, REVIEW_DIR, EXCEL_DIR, ERROR_DIR].forEach(d =>
  !fs.existsSync(d) && fs.mkdirSync(d, { recursive: true })
);

const TIPO_POR_EXT = {
  ".pdf":"pdf",
  ".doc":"word", ".docx":"word", ".odt":"word", ".rtf":"word",
  ".xlsx":"excel", ".xls":"excel", ".csv":"excel", ".ods":"excel",
  ".png":"imagen", ".jpg":"imagen", ".jpeg":"imagen", ".tiff":"imagen", ".bmp":"imagen", ".webp":"imagen",
  ".xml":"word",
};

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "50mb" }));

app.get("/api/status", (_, res) => res.json({ ok: true }));

// ── INPUT / OUTPUT / DESCARTADAS / REVISAR ────────────────────────
app.get("/api/input", (_, res) => {
  try {
    const archivos = fs.readdirSync(INPUT_DIR)
      .filter(f => !f.startsWith(".") && TIPO_POR_EXT[path.extname(f).toLowerCase()])
      .map(f => {
        const ext  = path.extname(f).toLowerCase();
        const stat = fs.statSync(path.join(INPUT_DIR, f));
        return { nombre: f, tipo: TIPO_POR_EXT[ext], tamanyo: stat.size, fecha: stat.mtime };
      }).sort((a, b) => a.nombre.localeCompare(b.nombre));
    res.json({ ok: true, archivos });
  } catch (e) { res.json({ ok: false, archivos: [], error: e.message }); }
});

app.get("/api/output", (_, res) => {
  try {
    const archivos = fs.readdirSync(OUTPUT_DIR)
      .filter(f => !f.startsWith(".") && f.endsWith(".pdf"))
      .map(f => {
        const stat = fs.statSync(path.join(OUTPUT_DIR, f));
        return { nombre: f, tamanyo: stat.size, fecha: stat.mtime };
      }).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    res.json({ ok: true, archivos });
  } catch (e) { res.json({ ok: false, archivos: [], error: e.message }); }
});

app.get("/api/descartadas", (_, res) => {
  try {
    const archivos = fs.readdirSync(TRASH_DIR)
      .filter(f => !f.startsWith("."))
      .map(f => {
        const ext  = path.extname(f).toLowerCase();
        const stat = fs.statSync(path.join(TRASH_DIR, f));
        return { nombre: f, tipo: TIPO_POR_EXT[ext] || "desconocido", tamanyo: stat.size, fecha: stat.mtime };
      }).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    res.json({ ok: true, archivos });
  } catch (e) { res.json({ ok: false, archivos: [], error: e.message }); }
});

app.get("/api/revisar", (_, res) => {
  try {
    const archivos = fs.readdirSync(REVIEW_DIR)
      .filter(f => !f.startsWith("."))
      .map(f => {
        const ext  = path.extname(f).toLowerCase();
        const stat = fs.statSync(path.join(REVIEW_DIR, f));
        return { nombre: f, tipo: TIPO_POR_EXT[ext] || "desconocido", tamanyo: stat.size, fecha: stat.mtime };
      }).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    res.json({ ok: true, archivos });
  } catch (e) { res.json({ ok: false, archivos: [], error: e.message }); }
});

// ── UPLOAD ────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, INPUT_DIR),
  filename:    (req, file, cb) => {
    cb(null, Buffer.from(file.originalname, "latin1").toString("utf8"));
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const nombre = Buffer.from(file.originalname, "latin1").toString("utf8");
    cb(null, !!TIPO_POR_EXT[path.extname(nombre).toLowerCase()]);
  },
});

app.post("/api/upload", (req, res) => {
  upload.array("archivos", 50)(req, res, (err) => {
    if (err) return res.status(500).json({ ok: false, error: err.message });
    if (!req.files?.length)
      return res.status(400).json({ ok: false, error: "No se recibieron archivos validos." });
    res.json({ ok: true, subidos: req.files.map(f => f.filename), total: req.files.length });
  });
});

// ── HELPERS ───────────────────────────────────────────────────────
function borrar(fp) {
  try { if (fp && fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}
}
function tmpPath(base, sufijo) {
  return base.replace(/\.[^.]+$/, "__" + sufijo + ".pdf");
}

async function extraerTextoPDF(pdfPath) {
  const data = await pdfParse(fs.readFileSync(pdfPath));
  return (data.text || "").replace(/\s+/g, " ").trim();
}

async function extraerTextoPDFBuffer(buffer) {
  const data = await pdfParse(buffer);
  return (data.text || "").replace(/\s+/g, " ").trim();
}

function textoUtil(t) {
  if (!t || t.length < 40) return false;
  return (t.match(/[a-zA-Z0-9\u00C0-\u024F]/g) || []).length >= 20;
}

function limpiarTexto(t) {
  return t.replace(/\r\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function pdfAImagenBase64(pdfPath) {
  try {
    const pdfjsLib        = require("pdfjs-dist/legacy/build/pdf.js");
    const { createCanvas } = require("canvas");
    const data     = new Uint8Array(fs.readFileSync(pdfPath));
    const doc      = await pdfjsLib.getDocument({ data }).promise;
    const page     = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 2.5 });
    const canvas   = createCanvas(viewport.width, viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.92).split(",")[1];
  } catch (e) {
    console.error("pdfAImagenBase64:", e.message);
    return null;
  }
}

function imagenABase64(filePath) {
  return fs.readFileSync(filePath).toString("base64");
}

function getMimeType(ext) {
  return { ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".png":"image/png",
           ".bmp":"image/bmp", ".tiff":"image/tiff", ".webp":"image/webp" }[ext] || "image/jpeg";
}

async function convertirConGotenberg(filePath, log) {
  log.push("  [Gotenberg] Convirtiendo a PDF...");
  const ext     = path.extname(filePath).toLowerCase();
  const mimeMap = {
    ".docx":"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc" :"application/msword",
    ".odt" :"application/vnd.oasis.opendocument.text",
    ".rtf" :"text/rtf",
    ".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls" :"application/vnd.ms-excel",
    ".csv" :"text/csv",
    ".ods" :"application/vnd.oasis.opendocument.spreadsheet",
    ".xml" :"application/xml",
  };
  const blob = new Blob([fs.readFileSync(filePath)], { type: mimeMap[ext] || "application/octet-stream" });
  const form = new globalThis.FormData();
  form.append("files", blob, path.basename(filePath));
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 180000);
  try {
    const resp = await fetch(GOTENBERG_URL, { method: "POST", body: form, signal: ctrl.signal });
    if (!resp.ok) throw new Error("Gotenberg HTTP " + resp.status);
    const out = tmpPath(filePath, "gotenberg");
    fs.writeFileSync(out, Buffer.from(await resp.arrayBuffer()));
    log.push("  [Gotenberg] OK");
    return out;
  } finally { clearTimeout(timer); }
}

// ── PROMPT (genérico, nombres de empresa desde .env) ──────────────
function buildPrompt() {
  const empresasCliente = [NOMBRE_EMPRESA_PROMPT, NOMBRE_EMPRESA_2_PROMPT]
    .filter(Boolean)
    .join(", ");

  const cifLinea = CIF_EMPRESA
    ? `- ${empresasCliente}, CIF ${CIF_EMPRESA}`
    : `- ${empresasCliente}`;

  const excepcionLinea = NOMBRE_EMPRESA_2_PROMPT
    ? `EXCEPCIÓN ÚNICA: Si el documento está emitido literalmente por ${NOMBRE_EMPRESA_2_PROMPT} (membrete superior con su logo) → devolver "${NOMBRE_EMPRESA_2_PROMPT.replace(/\s+/g, "")}".`
    : "";

  const cifRegla = CIF_EMPRESA
    ? `Si ves ${CIF_EMPRESA} junto a ${NOMBRE_EMPRESA_PROMPT} → son el cliente, busca el proveedor real en otro lugar del documento.`
    : "";

  return `Eres un extractor de datos de facturas españolas. Analiza la imagen del documento.
Devuelve ÚNICAMENTE JSON válido, sin markdown ni explicaciones.

REGLA FUNDAMENTAL — EMISOR vs CLIENTE:
El EMISOR es quien aparece en el MEMBRETE SUPERIOR (normalmente arriba a la izquierda) con su nombre comercial, dirección, CIF/NIF y datos de contacto. Es quien COBRA.
El CLIENTE/DESTINATARIO es quien aparece en el bloque de dirección de envío (normalmente a la derecha o en el centro). Es quien PAGA.
NUNCA confundas emisor y cliente.

EMPRESAS CLIENTE HABITUALES — REGLA ESTRICTA:
${cifLinea}

Estas empresas son SIEMPRE el CLIENTE que paga. NUNCA el proveedor que cobra.
El proveedor REAL es quien tiene su membrete, logo, nombre y CIF DIFERENTE${CIF_EMPRESA ? " a " + CIF_EMPRESA : ""} en el documento.
${cifRegla}
${excepcionLinea}

PASO 1 — CLASIFICAR:
Es factura si tiene AL MENOS DOS de:
- Palabra "factura", "invoice", "fra."
- Número de factura con etiqueta (Nº, Nº Factura, Num., Fra., Factura, Número, Number, Numero de Documento, Factura Nº #)
- Fecha de emisión
- Importe total, base imponible o IVA
- CIF/NIF del emisor

NO es factura: presupuesto, proforma, albarán, bono, reserva, póliza de seguro, boarding pass, extracto bancario, nómina, contrato, email.
Si hay duda: {"es_factura": false}

PASO 2 — EXTRAER (solo si es factura):
- proveedor: nombre comercial del EMISOR del membrete superior. Sin forma jurídica (SL, SA, SLU, CB...). Sin acentos, guiones ni espacios. Máx 5 palabras unidas.
- numero_factura: número junto a etiqueta "Nº", "Nº factura", "Número", "Fra.", "Invoice no", "FACTURA:", "Factura Nº", "Numero de Documento". Si tiene barra (26/0069) devuélvelo completo. NUNCA: teléfonos 9 dígitos, CIFs/NIFs, códigos postales, IBANs, localizadores. Si no hay etiqueta: "desconocido".
- fecha: fecha de EMISIÓN dd-MM-yyyy. No usar fecha de pago ni estancia.
- total: importe FINAL con impuestos. Formato 1234.56. Buscar SIEMPRE en la sección de RESUMEN o TOTALES al final del documento. Si hay varios importes parciales en el cuerpo, ignorarlos. El total correcto es el que aparece junto a "Total", "Total Factura" o "TOTAL" en el resumen final. Si "Total a pagar", "A pagar" o "Pendiente" es 0.00, usar el importe de "Total Factura" en su lugar.

REGLAS ESPECÍFICAS POR PROVEEDOR:
- PENSION DIANA (Diana Iglesias Neira, O Pino): número de factura con formato "A/XX" (ej: A/40, A/77). Suele estar en la tabla "Nº Factura".

Si campo no determinable: "desconocido"

Si NO es factura: {"es_factura": false}
Si ES factura: {"es_factura": true, "proveedor": "", "numero_factura": "", "fecha": "", "total": ""}`;
}

// ── LLAMADAS IA ───────────────────────────────────────────────────
async function llamarOpenAIVision(imagenBase64, mimeType, textoContexto) {
  const PROMPT = buildPrompt();
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  const mensajeTexto = textoContexto
    ? `${PROMPT}\n\nTEXTO EXTRAÍDO DEL PDF (puede estar desordenado por columnas, úsalo como referencia pero prioriza lo que ves en la imagen):\n${limpiarTexto(textoContexto).substring(0, 3000)}`
    : PROMPT;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + OPENAI_KEY },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: [
          { type: "text", text: mensajeTexto },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${imagenBase64}`, detail: "high" } }
        ]}],
        temperature: 0, max_tokens: 500,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error("OpenAI Vision HTTP " + resp.status);
    const data = await resp.json();
    const raw  = (data.choices?.[0]?.message?.content || "").trim()
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON no encontrado");
    return JSON.parse(match[0]);
  } finally { clearTimeout(timer); }
}

async function llamarOpenAITexto(texto) {
  const PROMPT = buildPrompt();
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + OPENAI_KEY },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: PROMPT + "\n\nTEXTO EXTRAÍDO DEL PDF:\n" + limpiarTexto(texto).substring(0, 6000) }],
        temperature: 0, max_tokens: 500,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error("OpenAI texto HTTP " + resp.status);
    const data = await resp.json();
    const raw  = (data.choices?.[0]?.message?.content || "").trim()
      .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON no encontrado en respuesta texto");
    return JSON.parse(match[0]);
  } finally { clearTimeout(timer); }
}

async function llamarGroq(texto) {
  const PROMPT = buildPrompt();
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + GROQ },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: PROMPT + "\n\nTEXTO:\n" + limpiarTexto(texto).substring(0, 6000) }],
      temperature: 0, max_tokens: 500,
    }),
  });
  if (!resp.ok) throw new Error("Groq HTTP " + resp.status);
  const data  = await resp.json();
  const raw   = (data.choices?.[0]?.message?.content || "").trim()
    .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON no encontrado en respuesta Groq");
  return JSON.parse(match[0]);
}

function extraerNumeroFactura(texto) {
  const patrones = [
    /(?:Nº\s*de\s*factura|Nº\s*factura|Num\.\s*factura|Factura\s*nº|Fra\.|Invoice\s*no\.?|FACTURA\s*:)\s*[:.]?\s*([A-Z0-9][A-Z0-9\/\-]{1,19})/i,
    /(?:Numero\s*de\s*Documento|N[uú]mero\s*de\s*Doc\.?)\s*[:.]?\s*([A-Z0-9][A-Z0-9\/\-]{1,19})/i,
    /(?:FACTURA|Fra)\s+(?:N[ºo°]|NUM|NÚM)\.?\s*[:.]?\s*([A-Z0-9][A-Z0-9\/\-]{1,19})/i,
    /N[ºo°]\s*Factura\s*[\n\r\s]+([A-Z][\/\-]?\d{1,6})/i,
  ];
  for (const patron of patrones) {
    const match = texto.match(patron);
    if (match) {
      const n = match[1].replace(/[\s]/g, "");
      if (!/^[6789]\d{8}$/.test(n) && !/^[A-Z]\d{8}$/.test(n) && !/^\d{8}[A-Z]$/.test(n) && !/^factura$/i.test(n)) return n;
    }
  }
  return null;
}

// ── ANÁLISIS PRINCIPAL ────────────────────────────────────────────
async function analizarDocumento(texto, imagenBase64, mimeType, log) {
  if (OPENAI_KEY && imagenBase64) {
    try {
      log.push("  [Vision] Analizando...");
      const datos = await llamarOpenAIVision(imagenBase64, mimeType, texto);
      log.push("  [Vision] OK: " + JSON.stringify(datos));

      if (datos && datos.es_factura && (!datos.numero_factura || datos.numero_factura === "desconocido") && textoUtil(texto)) {
        const numeroRegex = extraerNumeroFactura(texto);
        if (numeroRegex) {
          log.push("  Número extraído por regex: " + numeroRegex);
          datos.numero_factura = numeroRegex;
        }
      }

      if (!datos.es_factura && textoUtil(texto)) {
        log.push("  [Vision] Dudoso — verificando con texto...");
        try {
          const datos2 = await llamarOpenAITexto(texto);
          log.push("  [OpenAI texto] OK: " + JSON.stringify(datos2));
          if (datos2.es_factura && PROVEEDORES_PROPIOS.some(p => limpiar(datos2.proveedor || "").toLowerCase().includes(p))) {
            log.push("  [OpenAI texto] Proveedor propio en texto desordenado — ignorando");
            return datos;
          }
          if (datos2.es_factura) return datos2;
        } catch (e2) {
          log.push("  [OpenAI texto] Error: " + e2.message);
        }
      }

      return datos;
    } catch (e) {
      log.push("  [Vision] Error: " + e.message);
    }
  }

  if (OPENAI_KEY && textoUtil(texto)) {
    try {
      log.push("  [OpenAI texto] Analizando...");
      const datos = await llamarOpenAITexto(texto);
      log.push("  [OpenAI texto] OK: " + JSON.stringify(datos));
      return datos;
    } catch (e) {
      log.push("  [OpenAI texto] Error: " + e.message);
    }
  }

  if (GROQ && textoUtil(texto)) {
    try {
      log.push("  [Groq] Analizando...");
      const datos = await llamarGroq(texto);
      log.push("  [Groq] OK: " + JSON.stringify(datos));
      return datos;
    } catch (e) {
      log.push("  [Groq] Error: " + e.message);
    }
  }

  throw new Error("Todos los métodos de análisis fallaron - Movido a carpeta errores para su revisión");
}

// ── VALIDAR ───────────────────────────────────────────────────────
function validarDatos(d) {
  if (!d) return { valido: false, motivo: "Respuesta vacía" };
  if (!d.es_factura) return { valido: false, motivo: "No es factura" };

  if (!d.proveedor?.trim() || d.proveedor.trim() === "desconocido")
    return { valido: false, motivo: "Proveedor desconocido", revisar: true };

  if (!d.numero_factura?.trim()) d.numero_factura = "desconocido";
  if (!d.total?.toString().trim()) d.total = "desconocido";

  if (d.numero_factura && d.numero_factura !== "desconocido") {
    const n = d.numero_factura.replace(/[\s\-\.]/g, "");
    if (
      /^[6789]\d{8}$/.test(n) ||
      /^[89]\d{8}$/.test(n)   ||
      /^[A-Z]\d{8}$/.test(n)  ||
      /^\d{8}[A-Z]$/.test(n)  ||
      (CIF_EMPRESA && n.toUpperCase() === CIF_EMPRESA.toUpperCase()) ||
      /^factura$/i.test(n)    ||
      n.length > 25
    ) { d.numero_factura = "desconocido"; }
  }

  if (d.fecha && d.fecha !== "desconocido") {
    d.fecha = d.fecha.trim().replace(/\//g, "-");
    if (/^\d{2}-\d{2}-\d{2}$/.test(d.fecha))
      d.fecha = d.fecha.slice(0, 6) + "20" + d.fecha.slice(6);
    if (!/^\d{2}-\d{2}-\d{4}$/.test(d.fecha))
      d.fecha = "desconocido";
  }
  if (!d.fecha?.trim()) d.fecha = "desconocido";

  return { valido: true };
}

// ── NOMBRE ────────────────────────────────────────────────────────
function limpiar(str) {
  return String(str || "X")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "")
    .replace(/\//g, "-")
    .replace(/[\\:*?"<>|€\s]/g, "")
    .replace(/_{2,}/g, "_").substring(0, 40);
}

function generarNombre(datos) {
  const total = datos.total === "desconocido" ? "0" : (() => {
    let t = String(datos.total);
    if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
    return t.replace(/[^0-9.]/g, "");
  })();
  return limpiar(datos.proveedor) + "_" + limpiar(datos.numero_factura) + "_" +
    String(datos.fecha).replace(/\//g, "-") + "_" + total + ".pdf";
}

function nombreUnicoEnDir(nombre, dir) {
  let out = path.join(dir, nombre);
  if (!fs.existsSync(out)) return out;
  const base = nombre.replace(/\.pdf$/i, "");
  let i = 2;
  while (fs.existsSync(path.join(dir, base + "_" + i + ".pdf"))) i++;
  return path.join(dir, base + "_" + i + ".pdf");
}

// ── PROCESAR ARCHIVO ──────────────────────────────────────────────
async function procesarArchivo(nombreOriginal) {
  const filePath = path.join(INPUT_DIR, nombreOriginal);
  const ext      = path.extname(nombreOriginal).toLowerCase();
  const tipo     = TIPO_POR_EXT[ext] || "desconocido";
  const log      = ["Archivo: " + nombreOriginal + " [tipo: " + tipo + "]"];
  const t0       = Date.now();
  const temps    = [];

  try {
    let texto = "", pdfFinal = null, imagenBase64 = null, mimeType = "image/jpeg";

    if (tipo === "pdf") {
      texto    = await extraerTextoPDF(filePath);
      pdfFinal = filePath;
      log.push("  PDF — texto: " + texto.length + " chars");
      imagenBase64 = await pdfAImagenBase64(filePath);
      log.push(imagenBase64 ? "  Imagen OK" : "  Sin imagen");
    } else if (tipo === "word" || tipo === "excel") {
      log.push("  Convirtiendo a PDF con Gotenberg...");
      pdfFinal = await convertirConGotenberg(filePath, log);
      temps.push(pdfFinal);
      texto = await extraerTextoPDF(pdfFinal);
      log.push("  " + tipo + " — texto: " + texto.length + " chars");
      imagenBase64 = await pdfAImagenBase64(pdfFinal);
      log.push(imagenBase64 ? "  Imagen OK" : "  Sin imagen");
    } else if (tipo === "imagen") {
      imagenBase64 = imagenABase64(filePath);
      mimeType     = getMimeType(ext);
      pdfFinal     = filePath;
      log.push("  Imagen directa");
    }

    if (!textoUtil(texto) && !imagenBase64)
      throw new Error("No se pudo extraer contenido del archivo");

    log.push("  Analizando...");
    const datos = await analizarDocumento(texto, imagenBase64, mimeType, log);

    const val = validarDatos(datos);
    if (!val.valido) {
      const esRevisar = val.revisar && datos?.es_factura;
      const destDir   = esRevisar ? REVIEW_DIR : TRASH_DIR;
      const destPath  = path.join(destDir, nombreOriginal);
      try { fs.renameSync(filePath, destPath); } catch (_) { borrar(filePath); }
      temps.forEach(borrar);
      log.push("  " + (esRevisar ? "Revisar: " : "Descartado: ") + val.motivo);
      return { ok: false, esFactura: esRevisar, motivo: val.motivo, nombreOriginal, tipo,
        usoVision: !!imagenBase64, log, ms: Date.now() - t0 };
    }

    const proveedorLimpio = limpiar(datos.proveedor).toLowerCase();
    const esPropio = PROVEEDORES_PROPIOS.length > 0 &&
      PROVEEDORES_PROPIOS.some(p => proveedorLimpio.includes(p));
    const destino  = esPropio ? REVIEW_DIR : OUTPUT_DIR;

    const nombreFinal = path.basename(nombreUnicoEnDir(generarNombre(datos), destino));
    fs.copyFileSync(pdfFinal || filePath, path.join(destino, nombreFinal));
    log.push("  " + (esPropio ? "En revisión (proveedor propio): " : "Guardado: ") + nombreFinal);
    temps.forEach(borrar);
    borrar(filePath);

    return {
      ok: true, esFactura: true, nombre: nombreFinal, nombreOriginal, tipo,
      enRevision: esPropio,
      usoVision: !!imagenBase64,
      datos: { proveedor: datos.proveedor, numero_factura: datos.numero_factura,
               fecha: datos.fecha, total: datos.total },
      log, ms: Date.now() - t0,
    };

  } catch (err) {
    temps.forEach(borrar);
    try {
      if (fs.existsSync(filePath)) {
        const destError = nombreUnicoEnDir(nombreOriginal, ERROR_DIR);
        fs.renameSync(filePath, destError);
      }
    } catch (_) {}
    log.push("  ERROR: " + err.message);
    log.push("  Archivo guardado en carpeta errores para revisión manual");
    return { ok: false, esFactura: false, enError: true, error: err.message, nombreOriginal, tipo,
      usoVision: false, log, ms: Date.now() - t0 };
  }
}

app.post("/api/procesar", async (req, res) => {
  if (!OPENAI_KEY && !GROQ)
    return res.status(500).json({ ok: false, error: "No hay API key configurada en .env" });

  const archivos = fs.readdirSync(INPUT_DIR).filter(f =>
    !f.startsWith(".") && TIPO_POR_EXT[path.extname(f).toLowerCase()]
  );
  if (!archivos.length)
    return res.status(400).json({ ok: false, error: "No hay archivos en input." });

  const resultados = [];
  const BATCH = 2;
  for (let i = 0; i < archivos.length; i += BATCH) {
    const r = await Promise.all(archivos.slice(i, i + BATCH).map(f => procesarArchivo(f)));
    resultados.push(...r);
    if (i + BATCH < archivos.length) await new Promise(res => setTimeout(res, 1500));
  }

  return res.json({
    ok: true,
    total:      archivos.length,
    facturas:   resultados.filter(r => r.ok && !r.enRevision).length,
    revision:   resultados.filter(r => r.ok && r.enRevision).length,
    noFacturas: resultados.filter(r => !r.ok && !r.error).length,
    errores:    resultados.filter(r => !r.ok && r.error).length,
    resultados,
  });
});

// ── VERIFICAR CIF ─────────────────────────────────────────────────
async function extraerCIF(texto, imagenBase64, mimeType) {
  const empresasCliente = [NOMBRE_EMPRESA_PROMPT, NOMBRE_EMPRESA_2_PROMPT].filter(Boolean).join(" o ");
  const prompt = `En este documento de factura, encuentra el CIF/NIF del CLIENTE (quien recibe y paga).
El cliente es ${empresasCliente}${CIF_EMPRESA ? " (CIF " + CIF_EMPRESA + ")" : ""}.
Devuelve SOLO el CIF/NIF sin espacios ni puntos. Si no lo encuentras devuelve nada.`;

  try {
    if (OPENAI_KEY) {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      const content = (!textoUtil(texto) && imagenBase64)
        ? [{ type: "text", text: prompt },
           { type: "image_url", image_url: { url: `data:${mimeType};base64,${imagenBase64}`, detail: "high" } }]
        : prompt + "\n\nTEXTO:\n" + texto.substring(0, 2000);
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + OPENAI_KEY },
        body: JSON.stringify({
          model: (!textoUtil(texto) && imagenBase64) ? "gpt-4o" : "gpt-4o-mini",
          messages: [{ role: "user", content }],
          temperature: 0, max_tokens: 20,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) return "";
      const data = await resp.json();
      const raw  = (data.choices?.[0]?.message?.content || "").trim().replace(/[^A-Z0-9]/gi, "");
      return raw.length >= 8 ? raw.toUpperCase() : "";
    } else if (GROQ) {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const resp  = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + GROQ },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: prompt + "\n\nTEXTO:\n" + texto.substring(0, 2000) }],
          temperature: 0, max_tokens: 20,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) return "";
      const data = await resp.json();
      const raw  = (data.choices?.[0]?.message?.content || "").trim().replace(/[^A-Z0-9]/gi, "");
      return raw.length >= 8 ? raw.toUpperCase() : "";
    }
  } catch { return ""; }
  return "";
}

app.post("/api/verificar-cif", async (req, res) => {
  const { nombre, base64 } = req.body;
  if (!nombre || !base64) return res.status(400).json({ ok: false, error: "Faltan datos" });
  try {
    const buffer = Buffer.from(base64, "base64");
    let texto = "", imagenBase64 = null, mimeType = "image/jpeg";
    try { texto = await extraerTextoPDFBuffer(buffer); } catch (_) {}
    if (!textoUtil(texto)) {
      const e = path.extname(nombre).toLowerCase();
      if ([".jpg",".jpeg",".png",".bmp",".tiff"].includes(e)) {
        imagenBase64 = base64; mimeType = getMimeType(e);
      } else {
        const tmp = path.join(BASE_DIR, "tmp_cif_" + Date.now() + ".pdf");
        fs.writeFileSync(tmp, buffer);
        imagenBase64 = await pdfAImagenBase64(tmp);
        borrar(tmp);
      }
    }
    const cif      = await extraerCIF(texto, imagenBase64, mimeType);
    const coincide = CIF_EMPRESA ? cif.toUpperCase() === CIF_EMPRESA.toUpperCase() : false;
    res.json({ ok: true, cif, coincide });
  } catch (e) {
    res.json({ ok: false, error: e.message, cif: "", coincide: false });
  }
});

// ── EXCEL ─────────────────────────────────────────────────────────
app.post("/api/exportar-nuevo", async (req, res) => {
  const { facturas } = req.body;
  if (!facturas?.length) return res.status(400).json({ ok: false, error: "No hay facturas" });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Facturas");
  ws.columns = [
    { header: "Proveedor",      key: "proveedor",      width: 30 },
    { header: "Nº Factura",     key: "numero_factura", width: 20 },
    { header: "Fecha",          key: "fecha",          width: 15 },
    { header: "Total (€)",      key: "total",          width: 15 },
    { header: "CIF Cliente",    key: "cif",            width: 15 },
    { header: "Nombre fichero", key: "nombre_fichero", width: 50 },
  ];
  ws.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.alignment = { horizontal: "center" };
  });
  facturas.forEach(f => {
    const row = ws.addRow({ proveedor: f.proveedor, numero_factura: f.numero_factura,
      fecha: f.fecha, total: f.total, cif: f.cif || "", nombre_fichero: f.nombre_fichero });
    if (f.cif) row.getCell("cif").font = { color: { argb: f.cifCoincide ? "FF22C55E" : "FFEF4444" }, bold: !f.cifCoincide };
  });
  ws.addRow({ proveedor: "TOTAL", numero_factura: "", fecha: "",
    total: { formula: `=SUM(D2:D${facturas.length + 1})` }, cif: "", nombre_fichero: "" })
    .eachCell(c => { c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FE" } }; });
  const out = path.join(EXCEL_DIR, "RegistroFacturas_" + Date.now() + ".xlsx");
  await wb.xlsx.writeFile(out);
  res.json({ ok: true, ruta: out });
});

app.post("/api/exportar-anadir", async (req, res) => {
  const { facturas, rutaExcel } = req.body;
  if (!facturas?.length) return res.status(400).json({ ok: false, error: "No hay facturas" });
  if (!fs.existsSync(rutaExcel)) return res.status(400).json({ ok: false, error: "Excel no encontrado: " + rutaExcel });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(rutaExcel);
  const ws = wb.getWorksheet("Facturas") || wb.worksheets[0];
  let filaTotal = null;
  for (let i = ws.lastRow.number; i >= 1; i--) {
    if (ws.getRow(i).getCell(1).value === "TOTAL") { filaTotal = i; break; }
  }
  if (filaTotal) ws.spliceRows(filaTotal, 1);
  facturas.forEach(f => {
    const row = ws.addRow([f.proveedor, f.numero_factura, f.fecha, f.total, f.cif || "", f.nombre_fichero]);
    if (f.cif) row.getCell(5).font = { color: { argb: f.cifCoincide ? "FF22C55E" : "FFEF4444" }, bold: !f.cifCoincide };
  });
  const ultima = ws.lastRow.number;
  ws.addRow(["TOTAL", "", "", { formula: `=SUM(D2:D${ultima})` }, "", ""])
    .eachCell(c => { c.font = { bold: true }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FE" } }; });
  await wb.xlsx.writeFile(rutaExcel);
  res.json({ ok: true, ruta: rutaExcel });
});

// ── ARRANCAR ──────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log("\n  FacturApp -> http://localhost:" + PORT);
  console.log("  OpenAI:    " + (OPENAI_KEY ? "OK" : "no configurada"));
  console.log("  Groq:      " + (GROQ ? "OK (fallback)" : "no configurada"));
  console.log("  Gotenberg: " + GOTENBERG_URL);
  console.log("  Empresa:   " + (NOMBRE_EMPRESA_PROMPT || "no configurada"));
  console.log("  CIF:       " + (CIF_EMPRESA || "no configurado"));
  console.log("  Input:     " + INPUT_DIR);
  console.log("  Output:    " + OUTPUT_DIR + "\n");
});
