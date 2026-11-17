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
    render();
  } catch {
    const retry = element("button","","Try again");
    retry.onclick = () => location.reload();
    catalog.replaceChildren(element("p","empty","The collection could not be loaded."),retry);
  } finally { catalog.setAttribute("aria-busy", "false"); }
}
byId("close").onclick = () => detail.close();
detail.addEventListener("click", event => {if (event.target === detail) detail.close();});
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
