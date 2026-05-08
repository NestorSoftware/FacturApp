# 🧾 FacturApp

Herramienta de automatización para análisis y renombrado de facturas con GPT-4 Vision. Procesa PDFs, documentos Word, Excel e imágenes, extrae los datos clave con IA y los renombra automáticamente con un formato estandarizado.

---

## ¿Qué hace?

1. Subes facturas a la carpeta `input/` (o desde la interfaz web)
2. La IA analiza cada documento e identifica: proveedor, número de factura, fecha e importe total
3. El archivo se renombra con el formato `Proveedor_NumFactura_Fecha_Total.pdf` y se mueve a `output/`
4. Los documentos que no son facturas van a `descartadas/`, los dudosos a `revisar/` y los que fallan a `errores/`
5. Exporta un registro Excel con todas las facturas procesadas

---

## Tecnologías

- Node.js + Express
- OpenAI GPT-4o Vision (análisis principal)
- GPT-4o-mini (análisis por texto)
- Groq LLaMA 3.3 70B (fallback sin coste)
- Gotenberg (conversión de Word/Excel a PDF)
- ExcelJS (generación de registros)
- pdf-parse + pdfjs-dist (extracción de texto e imagen)

---

## Requisitos

- Node.js 18+
- Docker (para Gotenberg)
- Cuenta en OpenAI y/o Groq

---

## Instalación

```bash
git clone https://github.com/TU_USUARIO/FacturApp.git
cd FacturApp
npm install
```

Copia el archivo de ejemplo y rellena tus datos:

```bash
cp .env.example .env
```

Edita `.env` con tus claves y configuración de empresa.

---

## Configuración

```env
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
GOTENBERG_URL=http://localhost:3000
PORT=3005

CIF_EMPRESA=B00000000
PROVEEDORES_PROPIOS=miempresa,miotranombre
NOMBRE_EMPRESA_PROMPT=MI EMPRESA SL
NOMBRE_EMPRESA_2_PROMPT=MI OTRA MARCA
```

---

## Levantar Gotenberg

Gotenberg es necesario para convertir archivos Word y Excel a PDF antes de analizarlos:

```bash
docker run --rm -p 3000:3000 gotenberg/gotenberg:8
```

---

## Uso

```bash
npm start
```

Abre el navegador en `http://localhost:3005`

Para desarrollo con reinicio automático:

```bash
npm run dev
```

---

## Flujo de análisis

```
Archivo entrada
      │
      ├── PDF → extrae texto + renderiza imagen → GPT-4o Vision
      ├── Word / Excel → Gotenberg → PDF → GPT-4o Vision
      └── Imagen → GPT-4o Vision directo

GPT-4o Vision
      │
      ├── Es factura → renombrar → output/
      ├── Proveedor propio → revisar/
      ├── No es factura → descartadas/
      └── Error → errores/
```

---

## Modelos de IA y fallback

| Situación | Modelo usado |
|---|---|
| PDF con imagen renderizable | GPT-4o Vision |
| PDF solo texto | GPT-4o-mini |
| Sin clave OpenAI | Groq LLaMA 3.3 70B (gratuito) |

---

## App de escritorio

El proyecto incluye soporte para **Electron**, lo que permite empaquetarlo como aplicación de escritorio nativa para Windows. Actualmente en desarrollo — la versión web es la principal.

Para compilar el instalador `.exe`:

```bash
npm run build
```

Genera el instalador en `dist/`.

---

## Estructura del proyecto

```
FacturApp/
├── public/          # Frontend web
├── server.js        # Servidor Express + lógica de procesamiento
├── package.json
├── .env.example     # Variables de entorno (plantilla)
├── .gitignore
└── README.md
```

---

## Autor

Néstor Pérez — [LinkedIn](https://linkedin.com/in/TU_PERFIL) · [GitHub](https://github.com/TU_USUARIO)
