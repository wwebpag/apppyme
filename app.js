let PRODUCTOS = [];
let SITE = {};
let carrito = JSON.parse(localStorage.getItem("carrito") || "[]");

async function cargarDatos(){
  const [site, productos] = await Promise.all([
    fetch("site.json").then(r => r.json()),
    fetch("productos.json").then(r => r.json())
  ]);
  SITE = site;
  PRODUCTOS = productos.filter(p => p.activo !== false);

  document.documentElement.setAttribute("data-paleta", site.paleta || "clasica");
  if (site.colorFondoCustom) document.body.style.setProperty("--color-fondo", site.colorFondoCustom);

  document.getElementById("nombre-tienda").textContent = site.nombre || "Mi Pastelería";
  document.getElementById("tagline-tienda").textContent = site.tagline || "";

  if (site.activa === false){
    document.getElementById("app").innerHTML = "<div class='encabezado'><h1>Volvemos pronto</h1><p>La tienda está temporalmente pausada.</p></div>";
    return;
  }

  poblarCategorias();
  renderizarProductos();
  actualizarCarritoUI();
}

function poblarCategorias(){
  const select = document.getElementById("filtro-categoria");
  const categorias = [...new Set(PRODUCTOS.map(p => p.categoria).filter(Boolean))];
  categorias.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c; opt.textContent = c;
    select.appendChild(opt);
  });
}

function renderizarProductos(){
  const texto = document.getElementById("buscador").value.toLowerCase();
  const categoria = document.getElementById("filtro-categoria").value;

  const filtrados = PRODUCTOS.filter(p => {
    const coincideTexto = p.nombre.toLowerCase().includes(texto);
    const coincideCategoria = !categoria || p.categoria === categoria;
    return coincideTexto && coincideCategoria;
  });

  const grilla = document.getElementById("grilla-productos");
  grilla.innerHTML = "";
  if (filtrados.length === 0){
    grilla.innerHTML = "<p style='opacity:.6'>No hay productos que coincidan con la búsqueda.</p>";
    return;
  }

  filtrados.forEach(p => {
    const div = document.createElement("div");
    div.className = "tarjeta-producto";
    div.innerHTML = `
      <img class="foto" src="${(p.imagenes && p.imagenes[0]) || 'assets/placeholder.svg'}" alt="${p.nombre}">
      <div class="info">
        <div class="nombre">${p.nombre}</div>
        <div class="precio">$${p.precio.toLocaleString("es-AR")}</div>
      </div>`;
    div.addEventListener("click", () => abrirDetalle(p));
    grilla.appendChild(div);
  });
}

function abrirDetalle(p){
  const lb = document.createElement("div");
  lb.className = "lightbox";
  lb.innerHTML = `
    <button class="cerrar-panel">&times;</button>
    <img src="${(p.imagenes && p.imagenes[0]) || 'assets/placeholder.svg'}" alt="${p.nombre}">
    <div class="detalle">
      <h2 style="color:#fff">${p.nombre}</h2>
      <p>${p.descripcion || ""}</p>
      <p style="font-weight:600">$${p.precio.toLocaleString("es-AR")}</p>
      <button class="boton-principal agregar">Agregar al carrito</button>
    </div>`;
  lb.querySelector(".cerrar-panel").onclick = () => lb.remove();
  lb.querySelector(".agregar").onclick = () => { agregarAlCarrito(p.id); lb.remove(); };
  document.body.appendChild(lb);
}

function agregarAlCarrito(id){
  const existente = carrito.find(i => i.id === id);
  if (existente) existente.cantidad++;
  else carrito.push({ id, cantidad: 1 });
  guardarCarrito();
  actualizarCarritoUI();

  const producto = PRODUCTOS.find(p => p.id === id);
  mostrarToast("🎂 " + (producto ? producto.nombre : "Producto") + " agregado al carrito");
  const boton = document.getElementById("boton-abrir-carrito");
  boton.classList.remove("rebote");
  void boton.offsetWidth; // reinicia la animación si se agrega rápido varias veces
  boton.classList.add("rebote");
}

function mostrarToast(texto){
  const toast = document.getElementById("toast");
  toast.textContent = texto;
  toast.classList.add("mostrar");
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => toast.classList.remove("mostrar"), 2200);
}

function abrirCarrito(){
  document.getElementById("panel-carrito").classList.add("abierto");
  document.getElementById("overlay-carrito").classList.add("abierto");
}
function cerrarCarrito(){
  document.getElementById("panel-carrito").classList.remove("abierto");
  document.getElementById("overlay-carrito").classList.remove("abierto");
}

function contactarWhatsapp(){
  const mensaje = "¡Hola! Quería consultarte sobre los productos de " + (SITE.nombre || "la pastelería") + ".";
  window.open(`https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(mensaje)}`, "_blank");
}

function cambiarCantidad(id, delta){
  const item = carrito.find(i => i.id === id);
  if (!item) return;
  item.cantidad += delta;
  if (item.cantidad <= 0) carrito = carrito.filter(i => i.id !== id);
  guardarCarrito();
  actualizarCarritoUI();
}

function guardarCarrito(){ localStorage.setItem("carrito", JSON.stringify(carrito)); }

function actualizarCarritoUI(){
  const lista = document.getElementById("lista-carrito");
  const contador = document.getElementById("contador-carrito");
  lista.innerHTML = "";
  let total = 0;
  let cantidadTotal = 0;

  carrito.forEach(item => {
    const producto = PRODUCTOS.find(p => p.id === item.id);
    if (!producto) return;
    total += producto.precio * item.cantidad;
    cantidadTotal += item.cantidad;
    const div = document.createElement("div");
    div.className = "item-carrito";
    div.innerHTML = `
      <span>${producto.nombre}</span>
      <div class="cantidad-control">
        <button data-d="-1">-</button>
        <span>${item.cantidad}</span>
        <button data-d="1">+</button>
      </div>`;
    div.querySelectorAll("button").forEach(b => b.onclick = () => cambiarCantidad(item.id, parseInt(b.dataset.d)));
    lista.appendChild(div);
  });

  contador.textContent = cantidadTotal;
  document.getElementById("total-carrito-monto").textContent = "$" + total.toLocaleString("es-AR");
  document.getElementById("boton-confirmar").disabled = carrito.length === 0;
}

function armarMensajeWhatsapp(){
  const nombre = document.getElementById("input-nombre").value.trim();
  const direccion = document.getElementById("input-direccion").value.trim();
  if (!nombre || !direccion){
    alert("Completá tu nombre y la dirección de envío.");
    return null;
  }
  let total = 0;
  let detalle = carrito.map(item => {
    const producto = PRODUCTOS.find(p => p.id === item.id);
    total += producto.precio * item.cantidad;
    return `- ${producto.nombre} x${item.cantidad} ($${(producto.precio * item.cantidad).toLocaleString("es-AR")})`;
  }).join("\n");

  const mensaje = `¡Hola! Quiero hacer este pedido:\n\n${detalle}\n\nTotal: $${total.toLocaleString("es-AR")}\n\nEnvío a domicilio\nNombre: ${nombre}\nDirección: ${direccion}`;
  return mensaje;
}

function confirmarPedido(){
  const mensaje = armarMensajeWhatsapp();
  if (!mensaje) return;
  const url = `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(mensaje)}`;
  window.open(url, "_blank");
}

document.addEventListener("DOMContentLoaded", () => {
  cargarDatos();
  document.getElementById("buscador").addEventListener("input", renderizarProductos);
  document.getElementById("filtro-categoria").addEventListener("change", renderizarProductos);
  document.getElementById("boton-abrir-carrito").addEventListener("click", abrirCarrito);
  document.getElementById("boton-cerrar-carrito").addEventListener("click", cerrarCarrito);
  document.getElementById("overlay-carrito").addEventListener("click", cerrarCarrito);
  document.getElementById("boton-contacto").addEventListener("click", contactarWhatsapp);
  document.getElementById("boton-confirmar").addEventListener("click", confirmarPedido);
});