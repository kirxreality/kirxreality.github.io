"use strict";
const byId = id => document.getElementById(id);
const catalog = byId("catalog");
const filters = byId("filters");
const detail = byId("detail");
let collections = [];
let products = [];
function element(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function safeUrl(value, image = false) {
  if (!value || typeof value !== "string") return "";
  if (image && /^data:image\/(png|jpeg|webp|gif|avif);base64,/i.test(value)) return value;
  try {
    const url = new URL(value, location.href);
    if (url.protocol === "https:" || (image && url.origin === location.origin)) return url.href;
  } catch {}
  return "";
}
function photo(holder, product) {
  const fallback = () => holder.replaceChildren(element("span", "placeholder", "K × R"));
  const src = safeUrl(product.image, true);
  if (!src) { fallback(); return; }
  const image = new Image();
  image.alt = product.name;
  image.loading = "lazy";
  image.onerror = fallback;
  image.src = src;
  holder.replaceChildren(image);
}
function category(product) {
  return collections.find(group => String(group.id) === String(product.collection))?.name || "";
}
function priceText(value) {
  if (value === null || value === undefined || value === "") return "";
  if (/^\d+(\.\d+)?$/.test(String(value))) {
    return new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"}).format(Number(value));
  }
  return String(value);
}
function showDetail(product) {
  byId("detail-name").textContent = product.name;
  byId("description").textContent = product.description || "";
  byId("price").textContent = priceText(product.price);
  byId("label").textContent = category(product);
  photo(byId("detail-art"), product);
  byId("pieceSku").textContent = "SKU " + productSku(product);
  byId("addCart").onclick = () => {
    changeQuantity(product.id, 1);
    detail.close();
    openCart();
  };
  detail.showModal();
}
function render(selected = "") {
  const visible = selected ? products.filter(product => String(product.collection) === selected) : products;
  byId("count").textContent = visible.length + (visible.length === 1 ? " PIECE" : " PIECES");
  for (const button of filters.children) button.setAttribute("aria-pressed", String(button.value === selected));
  catalog.replaceChildren();
  for (const product of visible) {
    const card = element("button","card");
    const thumb = element("div","thumb");
    photo(thumb,product);
    card.append(thumb, element("h3","",product.name), element("p","meta",[category(product),priceText(product.price)].filter(Boolean).join(" · ")));
    card.addEventListener("click", () => showDetail(product));
    catalog.append(card);
  }
  if (!visible.length) catalog.append(element("p","empty", selected ? "No pieces in this collection yet." : "The next collection will appear here."));
}
async function init() {
  try {
    const result = await fetch("catalog.json", {cache:"no-cache"});
    if (!result.ok) throw new Error("Catalog unavailable");
    const data = await result.json();
    collections = data.collections;
    products = data.products;
    if (!Array.isArray(collections) || !Array.isArray(products)) throw new Error("Invalid catalog");
    const shop = safeUrl(data.shopUrl);
    if (shop) for (const link of document.querySelectorAll(".shop")) {link.href = shop;link.hidden = false;}
    if (collections.length) for (const group of [{id:"",name:"All pieces"}, ...collections]) {
      const button = element("button","",group.name);
      button.value = String(group.id);
      button.addEventListener("click", () => render(button.value));
      filters.append(button);
    }
    checkoutStore = data.checkoutStore || "";
    cartReady = true;
    renderCart();
    render();
  } catch {
    const retry = element("button","","Try again");
    retry.onclick = () => location.reload();
    catalog.replaceChildren(element("p","empty","The collection could not be loaded."),retry);
  } finally { catalog.setAttribute("aria-busy", "false"); }
}
byId("close").onclick = () => detail.close();
detail.addEventListener("click", event => {if (event.target === detail) detail.close();});
let checkoutStore = "";
let cartReady = false;
const storageKey = "kir-cart-v1";
let cart = {};
try {
  const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
  if (stored && typeof stored === "object" && !Array.isArray(stored)) cart = stored;
} catch {}
function productSku(product) { return product.sku || "KIR-" + product.id.toUpperCase(); }
function cartButton(label, action) {
  const btn = element("button","cart-action",label);
  btn.type = "button";
  btn.onclick = action;
  return btn;
}
const trigger = cartButton("Cart (0)",openCart);
document.querySelector("header nav").append(trigger);
const panel = document.createElement("dialog");
panel.id = "shopping-cart";
panel.setAttribute("aria-labelledby","cartTitle");
panel.innerHTML = '<div class="cart-head"><h2 id="cartTitle">Your cart</h2><button type="button" aria-label="Close cart">Close</button></div><div id="cartLines"></div><p id="cartTotal"></p><button id="buyNow" class="apply" type="button">Buy now &#8599;</button><p id="checkoutNote" role="status"></p>';
document.body.append(panel);
panel.querySelector(".cart-head button").onclick = () => panel.close();
const skuLabel = element("p","meta"); skuLabel.id = "pieceSku";
const add = cartButton("Add to cart",()=>{}); add.id = "addCart"; add.classList.add("apply");
byId("description").after(skuLabel,add);
const cartStyle = element("style");
cartStyle.textContent = `header nav .cart-action{background:#201e1d;color:white;border:1px solid #ffffff65;padding:.4rem .55rem;font-size:.75rem}#shopping-cart{width:min(530px,94vw);padding:clamp(18px,4vw,36px)}.cart-head,.cart-controls{display:flex;align-items:center;justify-content:space-between;gap:.6rem}.cart-head button,.cart-controls button{padding:.45rem;background:transparent;border:1px solid #a69b90}.cart-row{padding:1rem 0;border-bottom:1px solid #b7ada4}.cart-row p,#checkoutNote{font-size:.85rem;margin:.6rem 0;line-height:1.4}.cart-controls{justify-content:start}.cart-controls button{min-width:2rem}#cartTotal{margin:1.4rem 0;font-weight:700}#buyNow:disabled{opacity:.5;cursor:default}#addCart{margin-top:1rem}@media(max-width:420px){header{flex-wrap:wrap}.cart-head h2{font-size:2rem}}`;
document.head.append(cartStyle);
function changeQuantity(id, delta) {
  const quantity = Math.max(0,Math.min(99,(Number(cart[id]) || 0) + delta));
  if (quantity) cart[id] = quantity; else delete cart[id];
  try {localStorage.setItem(storageKey,JSON.stringify(cart));} catch {}
  renderCart();
}
function openCart() {renderCart();panel.showModal();}
function renderCart() {
  const lines = byId("cartLines");
  lines.replaceChildren();
  const items = products.filter(p=>Number.isInteger(cart[p.id]) && cart[p.id]>0 && cart[p.id]<=99);
  let count=0, cents=0;
  for (const p of items) {
    const qty=cart[p.id]; count+=qty;
    const price=Math.round(Number(p.price)*100);
    cents+=qty*price;
    const row=element("div","cart-row");
    const controls=element("div","cart-controls");
    for (const [label,delta,accessible] of [["−",-1,"Decrease"],["+",1,"Increase"],["Remove",-qty,"Remove"]]) {
      const button=cartButton(label,()=>changeQuantity(p.id,delta));
      button.setAttribute("aria-label",accessible+" "+p.name);
      button.disabled = delta===1 && qty===99;
      controls.append(button);
    }
    row.append(element("strong","",p.name),element("p","",productSku(p)+" · Qty "+qty+" · "+priceText(qty*price/100)),controls);
    lines.append(row);
  }
  trigger.textContent="Cart ("+count+")";
  if (!count) lines.textContent=cartReady ? "Your cart is empty." : "Loading collection…";
  byId("cartTotal").textContent=count ? "Subtotal "+priceText(cents/100) : "";
  let target;
  try {
    const shop=new URL(checkoutStore);
    if(shop.protocol==="https:" && shop.origin!==location.origin && !shop.username && !shop.password && items.length && items.every(p=>/^[1-9][0-9]*$/.test(p.variantId))) {
      target=new URL("/cart/"+items.map(p=>p.variantId+":"+cart[p.id]).join(","),shop.origin);
    }
  } catch {}
  const buy=byId("buyNow");
  buy.disabled=!target;
  buy.onclick=()=>{if(target) location.assign(target.href);};
  byId("checkoutNote").textContent=count ? (target ? "Shipping and payment are handled in our external store." : "Online ordering is not available for this selection yet.") : "";
}
init();

byId("application").addEventListener("submit", event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const answers = [
    ["Name", "name"], ["Email", "email"], ["Social handles", "handles"],
    ["Owns KIR merchandise", "merch"], ["Sponsored by other brands", "sponsors"],
    ["Why I would be a good partner", "reason"]
  ].map(([label, key]) => label + ": " + form.get(key));
  const subject = "KIR athlete application - " + form.get("name");
  location.href = "mailto:kirxreality@gmail.com?subject=" + encodeURIComponent(subject)
    + "&body=" + encodeURIComponent(answers.join("\n\n"));
  byId("application-status").textContent = "If your email app did not open, send your answers to kirxreality@gmail.com.";
});
