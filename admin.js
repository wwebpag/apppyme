let INGREDIENTES = [];
let RECETAS = [];
let PRODUCTOS = [];
let SITE = {};
let RAMA = "main";
let recetasExpandidas = new Set();

/* Unidades de medida: se agrupan por tipo para poder convertir entre sí (g<->kg, ml<->l) */
const FACTORES = { g: 1, kg: 1000, ml: 1, l: 1000, unidad: 1 };
const TIPOS_UNIDAD = { g: "peso", kg: "peso", ml: "volumen", l: "volumen", unidad: "unidad" };
const NOMBRES_UNIDAD = { g: "Gramos (g)", kg: "Kilogramos (kg)", ml: "Mililitros (ml)", l: "Litros (l)", unidad: "Unidad (ej: huevo, atado)" };

function unidadesCompatibles(unidadBase){
  const tipo = TIPOS_UNIDAD[unidadBase] || "unidad";
  return Object.keys(TIPOS_UNIDAD).filter(u => TIPOS_UNIDAD[u] === tipo);
}

function slug(texto){
  return texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
}
function authHeaders(){
  return { Authorization: `token ${localStorage.getItem("clave")}` };
}
function money(n){ return "$" + Math.round(n).toLocaleString("es-AR"); }

/* ===== GitHub API ===== */
async function obtenerRamaPredeterminada(){
  const r = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}`, { headers: authHeaders() });
  if (!r.ok) throw new Error("No se pudo acceder al repositorio. Revisá el token.");
  const d = await r.json();
  return d.default_branch;
}

async function guardarJSON(path, objeto, mensaje){
  let sha;
  try{
    const r = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents/${path}?ref=${RAMA}`, { headers: authHeaders() });
    if (r.ok){ const d = await r.json(); sha = d.sha; }
  }catch(e){}
  const contenido = btoa(unescape(encodeURIComponent(JSON.stringify(objeto, null, 2))));
  const body = { message: mensaje, content: contenido, branch: RAMA };
  if (sha) body.sha = sha;
  const resp = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents/${path}`, {
    method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error("Error guardando " + path);
  return resp.json();
}

async function subirImagenBinaria(path, base64Contenido, mensaje){
  const body = { message: mensaje, content: base64Contenido, branch: RAMA };
  const resp = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents/${path}`, {
    method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error("Error subiendo imagen");
  return resp.json();
}

/* ===== Login ===== */
async function intentarLogin(){
  const token = document.getElementById("input-clave").value.trim();
  if (!token) return;
  localStorage.setItem("clave", token);
  try{
    RAMA = await obtenerRamaPredeterminada();
    await cargarTodo();
    document.getElementById("pantalla-login").hidden = true;
    document.getElementById("pantalla-admin").hidden = false;
  }catch(e){
    document.getElementById("error-login").textContent = "Clave incorrecta o sin acceso al repositorio.";
    document.getElementById("error-login").hidden = false;
    localStorage.removeItem("clave");
  }
}

async function cargarTodo(){
  const base = `https://raw.githubusercontent.com/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/${RAMA}/`;
  const cacheBuster = "?t=" + Date.now();
  [INGREDIENTES, RECETAS, PRODUCTOS, SITE] = await Promise.all([
    fetch(base + "ingredientes.json" + cacheBuster).then(r => r.json()),
    fetch(base + "recetas.json" + cacheBuster).then(r => r.json()),
    fetch(base + "productos.json" + cacheBuster).then(r => r.json()),
    fetch(base + "site.json" + cacheBuster).then(r => r.json())
  ]);
  document.documentElement.setAttribute("data-paleta", SITE.paleta || "clasica");
  renderIngredientes();
  renderRecetas();
  renderConfig();
}

/* Aplica la paleta de colores ya en la pantalla de login, sin necesidad de estar logueado */
async function aplicarPaletaTemprano(){
  try{
    const r = await fetch(`https://api.github.com/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}`);
    const d = await r.json();
    const rSite = await fetch(`https://raw.githubusercontent.com/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/${d.default_branch}/site.json?t=${Date.now()}`);
    const site = await rSite.json();
    document.documentElement.setAttribute("data-paleta", site.paleta || "clasica");
  }catch(e){ /* si falla, se aplica igual al loguearse */ }
}
aplicarPaletaTemprano();

/* ===== Cálculo de costos ===== */
function calcularCostoReceta(receta){
  return (receta.ingredientes || []).reduce((acc, ing) => {
    const dato = INGREDIENTES.find(i => i.id === ing.id);
    if (!dato) return acc;
    const unidadUso = ing.unidad || dato.unidad;
    const cantidadEnUnidadBase = ing.cantidad * (FACTORES[unidadUso] || 1);
    const precioPorUnidadBase = dato.precio / (FACTORES[dato.unidad] || 1);
    return acc + cantidadEnUnidadBase * precioPorUnidadBase;
  }, 0);
}
function calcularPrecioFinal(receta){
  const costo = calcularCostoReceta(receta);
  const conMarkup = costo * (1 + (Number(receta.markup) || 0) / 100);
  return Math.ceil(conMarkup / 100) * 100;
}
function recalcularProductos(){
  PRODUCTOS = RECETAS.map(r => ({
    id: r.id,
    nombre: r.nombre,
    categoria: r.categoria || "",
    descripcion: r.descripcion || "",
    imagenes: r.imagenes || [],
    activo: r.activo !== false,
    precio: calcularPrecioFinal(r)
  }));
}

/* ===== Materia Prima ===== */
function renderIngredientes(){
  const filtro = (document.getElementById("buscador-ingredientes").value || "").toLowerCase();
  const tbody = document.getElementById("tbody-ingredientes");
  tbody.innerHTML = "";
  INGREDIENTES.forEach((ing, idx) => {
    if (filtro && !ing.nombre.toLowerCase().includes(filtro)) return;
    const opcionesUnidad = Object.keys(NOMBRES_UNIDAD)
      .map(u => `<option value="${u}" ${u === ing.unidad ? "selected" : ""}>${NOMBRES_UNIDAD[u]}</option>`).join("");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input value="${ing.nombre}" data-campo="nombre" data-idx="${idx}"></td>
      <td><select data-campo="unidad" data-idx="${idx}">${opcionesUnidad}</select></td>
      <td><input type="number" step="0.01" value="${ing.precio}" data-campo="precio" data-idx="${idx}" style="width:100px"></td>
      <td><button class="boton-chico" data-eliminar="${idx}">Quitar</button></td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("input, select").forEach(inp => {
    inp.addEventListener("input", () => {
      const idx = inp.dataset.idx, campo = inp.dataset.campo;
      INGREDIENTES[idx][campo] = campo === "precio" ? parseFloat(inp.value) || 0 : inp.value;
    });
  });
  tbody.querySelectorAll("[data-eliminar]").forEach(btn => {
    btn.addEventListener("click", () => {
      INGREDIENTES.splice(parseInt(btn.dataset.eliminar), 1);
      renderIngredientes();
    });
  });
}

document.getElementById("boton-agregar-ingrediente").addEventListener("click", () => {
  INGREDIENTES.push({ id: "ing-" + Date.now(), nombre: "Nuevo ingrediente", unidad: "kg", precio: 0 });
  renderIngredientes();
});

document.getElementById("boton-guardar-ingredientes").addEventListener("click", async () => {
  INGREDIENTES.forEach(i => { if (!i.id) i.id = slug(i.nombre) + "-" + Date.now(); });
  recalcularProductos();
  await guardarConAviso([
    ["ingredientes.json", INGREDIENTES, "Actualiza precios de materia prima"],
    ["productos.json", PRODUCTOS, "Recalcula precios de productos"]
  ], "materia prima");
  renderRecetas();
});

/* ===== Recetas ===== */
function renderRecetas(){
  const filtro = (document.getElementById("buscador-recetas").value || "").toLowerCase();
  const cont = document.getElementById("lista-recetas");
  cont.innerHTML = "";
  RECETAS.forEach((r, idx) => {
    const coincide = !filtro
      || (r.nombre || "").toLowerCase().includes(filtro)
      || (r.categoria || "").toLowerCase().includes(filtro);
    if (!coincide) return;
    if (recetasExpandidas.has(r.id)) cont.appendChild(tarjetaReceta(r, idx));
    else cont.appendChild(tarjetaRecetaColapsada(r));
  });
}

function tarjetaRecetaColapsada(r){
  const div = document.createElement("div");
  div.className = "tarjeta-admin tarjeta-receta-colapsada";
  div.innerHTML = `
    <img src="${(r.imagenes && r.imagenes[0]) || 'assets/placeholder.svg'}" alt="${r.nombre}">
    <span>${r.nombre || "Sin nombre"}</span>`;
  div.addEventListener("click", () => {
    recetasExpandidas.add(r.id);
    renderRecetas();
  });
  return div;
}

function tarjetaReceta(r, idx){
  const div = document.createElement("div");
  div.className = "tarjeta-admin";
  const costo = calcularCostoReceta(r);
  const precio = calcularPrecioFinal(r);

  const filasIng = (r.ingredientes || []).map((ing, iIdx) => filaIngredienteReceta(r, idx, ing, iIdx)).join("");

  div.innerHTML = `
    <button class="boton-chico" data-cerrar-receta="${idx}" style="margin-bottom:10px">◀ Cerrar</button>
    <div class="grid-2">
      <div><label>Nombre</label><input value="${r.nombre || ""}" data-r="${idx}" data-campo="nombre"></div>
      <div><label>Categoría</label><input value="${r.categoria || ""}" data-r="${idx}" data-campo="categoria"></div>
    </div>
    <div style="margin-top:8px"><label>Descripción</label><input value="${r.descripcion || ""}" data-r="${idx}" data-campo="descripcion" style="width:100%"></div>
    <div style="margin-top:8px"><label>% de gastos y ganancia para esta receta</label><input type="number" value="${r.markup || 0}" data-r="${idx}" data-campo="markup" style="width:100px"></div>

    <h3 style="margin-top:16px;font-size:1rem">Ingredientes usados</h3>
    <div data-filas-ing="${idx}">${filasIng}</div>
    <button class="boton-chico" data-agregar-ing="${idx}">+ ingrediente</button>

    <div class="preview-costo">Costo de producción: ${money(costo)} · Precio final al público: <b>${money(precio)}</b></div>

    <div style="margin-top:14px">
      <label>Fotos (subí una o más)</label><br>
      <input type="file" accept="image/*" multiple data-fotos="${idx}">
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
        ${(r.imagenes || []).map(src => `<img src="${src}" style="width:60px;height:60px;object-fit:cover;border-radius:6px">`).join("")}
      </div>
    </div>

    <div style="margin-top:14px;display:flex;gap:10px;align-items:center">
      <label><input type="checkbox" data-r="${idx}" data-campo="activo" ${r.activo !== false ? "checked" : ""}> Visible en la tienda</label>
      <button class="boton-chico" data-eliminar-receta="${idx}">Eliminar receta</button>
    </div>
  `;

  div.querySelectorAll("[data-campo]").forEach(el => {
    el.addEventListener("input", () => {
      const campo = el.dataset.campo;
      if (campo === "activo") r.activo = el.checked;
      else if (campo === "markup") r.markup = parseFloat(el.value) || 0;
      else r[campo] = el.value;
      if (campo === "markup"){
        div.querySelector(".preview-costo").innerHTML =
          `Costo de producción: ${money(calcularCostoReceta(r))} · Precio final al público: <b>${money(calcularPrecioFinal(r))}</b>`;
      }
    });
  });

  div.querySelector("[data-agregar-ing]").addEventListener("click", () => {
    if (!r.ingredientes) r.ingredientes = [];
    r.ingredientes.push({ id: INGREDIENTES[0]?.id || "", cantidad: 0 });
    renderRecetas();
  });

 div.querySelector("[data-eliminar-receta]").addEventListener("click", () => {
    RECETAS.splice(idx, 1);
    renderRecetas();
  });

  div.querySelector("[data-cerrar-receta]").addEventListener("click", () => {
    recetasExpandidas.delete(r.id);
    renderRecetas();
  });

  div.querySelector(`[data-fotos="${idx}"]`).addEventListener("change", async (e) => {
    for (const file of e.target.files){
      await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result.split(",")[1];
          const ext = file.name.split(".").pop();
          const path = `assets/${slug(r.nombre)}-${Date.now()}.${ext}`;
          try{
            await subirImagenBinaria(path, base64, "Sube foto de " + r.nombre);
            if (!r.imagenes) r.imagenes = [];
            r.imagenes.push(path);
            res();
          }catch(err){ rej(err); }
        };
        reader.readAsDataURL(file);
      });
    }
    renderRecetas();
  });

  return div;
}

function filaIngredienteReceta(r, idx, ing, iIdx){
  const dato = INGREDIENTES.find(i => i.id === ing.id) || INGREDIENTES[0];
  const compatibles = dato ? unidadesCompatibles(dato.unidad) : ["unidad"];
  if (!ing.unidad || !compatibles.includes(ing.unidad)) ing.unidad = dato ? dato.unidad : "unidad";

  const opcionesIng = INGREDIENTES.map(i => `<option value="${i.id}" ${i.id === ing.id ? "selected" : ""}>${i.nombre}</option>`).join("");
  const opcionesUnidad = compatibles.map(u => `<option value="${u}" ${u === ing.unidad ? "selected" : ""}>${u}</option>`).join("");

  return `
    <div class="fila-receta-ing">
      <select data-r="${idx}" data-i="${iIdx}" data-tipo="id">${opcionesIng}</select>
      <input type="number" step="0.01" value="${ing.cantidad}" data-r="${idx}" data-i="${iIdx}" data-tipo="cantidad" style="width:70px">
      <select data-r="${idx}" data-i="${iIdx}" data-tipo="unidad">${opcionesUnidad}</select>
      <button class="boton-chico" data-quitar-ing="${idx}-${iIdx}">x</button>
    </div>`;
}

function manejarCambioIngredienteReceta(e){
  const el = e.target;
  if (el.dataset.tipo && el.dataset.r !== undefined && el.dataset.i !== undefined){
    const r = RECETAS[el.dataset.r];
    const ing = r.ingredientes[el.dataset.i];
    if (el.dataset.tipo === "cantidad") ing.cantidad = parseFloat(el.value) || 0;
    else if (el.dataset.tipo === "unidad") ing.unidad = el.value;
    else { ing.id = el.value; ing.unidad = null; } // al cambiar de ingrediente, recalcula unidad compatible
    renderRecetas();
  }
}
document.getElementById("lista-recetas").addEventListener("input", manejarCambioIngredienteReceta);
document.getElementById("lista-recetas").addEventListener("change", manejarCambioIngredienteReceta);
document.getElementById("lista-recetas").addEventListener("click", (e) => {
  const q = e.target.dataset.quitarIng;
  if (q){
    const [r, i] = q.split("-").map(Number);
    RECETAS[r].ingredientes.splice(i, 1);
    renderRecetas();
  }
});

document.getElementById("boton-agregar-receta").addEventListener("click", () => {
  const nueva = { id: "receta-" + Date.now(), nombre: "Nueva receta", categoria: "", descripcion: "", markup: 50, ingredientes: [], imagenes: [], activo: true };
  RECETAS.push(nueva);
  recetasExpandidas.add(nueva.id);
  renderRecetas();
});

document.getElementById("boton-guardar-recetas").addEventListener("click", async () => {
  RECETAS.forEach(r => { if (!r.id) r.id = slug(r.nombre) + "-" + Date.now(); });
  recalcularProductos();
  await guardarConAviso([
    ["recetas.json", RECETAS, "Actualiza recetas"],
    ["productos.json", PRODUCTOS, "Recalcula precios de productos"]
  ], "recetas");
});

/* ===== Configuración de la tienda ===== */
function renderConfig(){
  document.getElementById("cfg-nombre").value = SITE.nombre || "";
  document.getElementById("cfg-tagline").value = SITE.tagline || "";
  document.getElementById("cfg-whatsapp").value = SITE.whatsapp || "";
  document.getElementById("cfg-instagram").value = SITE.instagram || "";
  document.getElementById("cfg-activa").checked = SITE.activa !== false;
  document.getElementById("cfg-paleta").value = SITE.paleta || "clasica";
}

document.getElementById("boton-guardar-config").addEventListener("click", async () => {
  SITE.nombre = document.getElementById("cfg-nombre").value;
  SITE.tagline = document.getElementById("cfg-tagline").value;
  SITE.whatsapp = document.getElementById("cfg-whatsapp").value;
  SITE.instagram = document.getElementById("cfg-instagram").value;
  SITE.activa = document.getElementById("cfg-activa").checked;
  SITE.paleta = document.getElementById("cfg-paleta").value;
  await guardarConAviso([["site.json", SITE, "Actualiza configuración de la tienda"]], "configuración");
});

/* ===== Guardado con aviso visual ===== */
async function guardarConAviso(lista, etiqueta){
  const aviso = document.getElementById("aviso-guardado");
  aviso.hidden = false;
  aviso.className = "aviso ok";
  aviso.textContent = "Guardando " + etiqueta + "...";
  try{
    for (const [path, objeto, mensaje] of lista){
      await guardarJSON(path, objeto, mensaje);
    }
    aviso.textContent = "Listo, se guardó " + etiqueta + " y la tienda ya se actualizó.";
  }catch(e){
    aviso.className = "aviso error";
    aviso.textContent = "No se pudo guardar: " + e.message;
  }
  setTimeout(() => aviso.hidden = true, 4000);
}

/* ===== Excel ===== */
document.getElementById("boton-excel").addEventListener("click", () => {
  const wb = XLSX.utils.book_new();
  const hojaIng = XLSX.utils.json_to_sheet(INGREDIENTES.map(i => ({ Nombre: i.nombre, Unidad: i.unidad, Precio: i.precio })));
  XLSX.utils.book_append_sheet(wb, hojaIng, "Materia Prima");
  const hojaProd = XLSX.utils.json_to_sheet(RECETAS.map(r => ({
    Nombre: r.nombre, Categoria: r.categoria, "Costo produccion": calcularCostoReceta(r),
    "% gastos/ganancia": r.markup, "Precio final": calcularPrecioFinal(r)
  })));
   XLSX.utils.book_append_sheet(wb, hojaProd, "Productos");
  const fecha = new Date();
  const meses = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
  const nombreArchivo = `precios-pasteleria-${meses[fecha.getMonth()]}-${fecha.getFullYear()}.xlsx`;
  XLSX.writeFile(wb, nombreArchivo);
});

/* ===== Tabs ===== */
document.querySelectorAll(".admin-tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".admin-tabs button").forEach(b => b.classList.remove("activo"));
    btn.classList.add("activo");
    document.querySelectorAll(".seccion-admin").forEach(s => s.hidden = true);
    document.getElementById("seccion-" + btn.dataset.tab).hidden = false;
  });
});

document.getElementById("boton-login").addEventListener("click", intentarLogin);
document.getElementById("buscador-ingredientes").addEventListener("input", renderIngredientes);
document.getElementById("buscador-recetas").addEventListener("input", renderRecetas);
document.getElementById("boton-logout").addEventListener("click", () => {
  localStorage.removeItem("clave");
  location.reload();
});

/* Si ya había una clave guardada en esta sesión, entra directo */
if (localStorage.getItem("clave")){
  obtenerRamaPredeterminada().then(r => { RAMA = r; return cargarTodo(); }).then(() => {
    document.getElementById("pantalla-login").hidden = true;
    document.getElementById("pantalla-admin").hidden = false;
  }).catch(() => localStorage.removeItem("clave"));
}
