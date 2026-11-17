"use strict";

const $ = id => document.getElementById(id);
const apiRoot = "https://api.github.com/repos/kirxreality/kirxreality.github.io";
const defaultPassword = "singer4ever!";
let password = defaultPassword;
let credential = "";
let catalog;
let branch;
let catalogSha;
let initialCatalog;
let editingId = "";
let dirty = false;
let formDirty = false;
let saving = false;
let uploadTask;
let uploadGeneration = 0;
let uploadFailure = false;
let selectedUpload;
const uploads = new Map();

function status(message, error = false) {
  $("status").textContent = message;
  $("status").dataset.error = String(error);
}
function problem(error) {
  status(error.message || "The request failed. Try again.", true);
}
function discardForm() {
  return !formDirty || confirm("Discard unsaved changes in the product form?");
}
function changes(message) {
  dirty = true;
  $("publish").disabled = false;
  $("summary").textContent = "Unpublished changes";
  status(message);
}
async function github(path, method = "GET", body) {
  const response = await fetch(apiRoot + path, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + credential,
      ...(body ? {"Content-Type": "application/json"} : {})
    },
    cache: "no-store",
    ...(body ? {body: JSON.stringify(body)} : {})
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw Error("GitHub denied access. Check the token, repository selection and Contents write permission.");
    if (response.status === 409 || response.status === 422) throw Error("GitHub could not apply this update. Your draft is still here. Check for a newer version or a protected branch.");
    throw Error("GitHub returned " + response.status + ". Check repository access and try again.");
  }
  return response.json();
}
function validateCatalog(value) {
  if (!value || !Array.isArray(value.products) || !Array.isArray(value.collections)) {
    throw Error("The catalog format could not be read. No changes were made.");
  }
  return value;
}
function httpsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw Error("Use a public HTTPS URL without credentials.");
  return url;
}
function imageSource(value) {
  if (!value) return "";
  if (/^https:\/\//i.test(value)) return httpsUrl(value).href;
  if (/^(?:\.\/)?[a-z\d_/-][a-z\d_./% -]*\.(?:webp|png|jpe?g|avif|gif)$/i.test(value) && !value.startsWith("/") && !value.includes("..")) return value;
  throw Error("Use a public HTTPS image or a relative image file in this repository.");
}
function preview(source) {
  const image = $("preview");
  image.hidden = !source;
  if (source) image.src = source;
  else image.removeAttribute("src");
}
function resetUpload() {
  uploadGeneration++;
  uploadTask = null;
  selectedUpload = null;
  uploadFailure = false;
  $("upload").value = "";
}
function renderProduct(product) {
  editingId = product?.id ?? "";
  $("productForm").reset();
  resetUpload();
  $("formTitle").textContent = product ? "Edit product" : "New product";
  $("deleteProduct").hidden = !product;
  $("productName").value = product?.name ?? "";
  $("description").value = product?.description ?? "";
  $("checkoutUrl").value = product?.checkoutUrl ?? "";
  $("price").value = product?.price ?? "";
  $("imageUrl").value = product?.image ?? "";
  const select = $("collectionSelect");
  select.replaceChildren(...catalog.collections.map(item => new Option(item.name, item.id)));
  if (product) select.value = product.collection;
  const image = product?.image || "";
  try { preview(uploads.get(image)?.dataUrl || imageSource(image)); } catch { preview(""); }
  formDirty = false;
}
function button(text, click) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = text;
  btn.onclick = click;
  return btn;
}
function renderProducts() {
  const filter = $("search").value.trim().toLowerCase();
  const products = catalog.products.filter(product => product.name.toLowerCase().includes(filter));
  const list = $("productList");
  list.replaceChildren();
  if (!products.length) list.textContent = filter ? "No matches." : "Your product list is empty.";
  for (const product of products) {
    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("strong");
    name.textContent = product.name;
    row.append(name, button("Edit", () => { if (discardForm()) renderProduct(product); }));
    list.append(row);
  }
}
function collectionExists(name, id) {
  return catalog.collections.some(item => item.id !== id && item.name.trim().toLowerCase() === name.toLowerCase());
}
function renderCollections() {
  const list = $("collectionList");
  list.replaceChildren();
  for (const item of catalog.collections) {
    const row = document.createElement("div");
    row.className = "row";
    const name = document.createElement("input");
    name.maxLength = 100;
    name.value = item.name;
    name.setAttribute("aria-label", "Collection name for " + item.name);
    row.append(name, button("Rename", () => {
      const nextName = name.value.trim();
      if (!nextName || collectionExists(nextName, item.id)) return status("Choose a unique collection name.", true);
      item.name = nextName;
      renderCollections();
      renderProduct(catalog.products.find(p => p.id === editingId));
      changes("Collection renamed in draft.");
    }), button("Remove", () => {
      if (catalog.products.some(p => p.collection === item.id)) return status("Move this collection’s products to another collection first.", true);
      if (!confirm("Remove “" + item.name + "” from the draft?")) return;
      catalog.collections = catalog.collections.filter(c => c.id !== item.id);
      renderCollections();
      renderProduct(catalog.products.find(p => p.id === editingId));
      changes("Collection removed from draft.");
    }));
    list.append(row);
  }
}
function section(id) {
  for (const name of ["products", "collections", "settings"]) $(name).hidden = name !== id;
  for (const nav of document.querySelectorAll("[data-view]")) nav.setAttribute("aria-pressed", String(nav.dataset.view === id));
}
async function start() {
  try {
    const response = await fetch("./catalog.json", {cache:"no-store"});
    if (!response.ok) throw Error("The showroom catalog is unavailable. Reload this page to retry.");
    const published = validateCatalog(await response.json());
    catalog = published;
    initialCatalog = JSON.stringify(published);
    password = published.studioPassword ?? defaultPassword;
    $("gate").hidden = false;
    status("Unlock the editor to manage the showroom.");
  } catch (error) { problem(error); }
}
$("gate").onsubmit = event => {
  event.preventDefault();
  const entered = $("password").value;
  $("password").value = "";
  if (entered !== password) return status("That studio password doesn’t match.", true);
  $("gate").hidden = true;
  $("workspace").hidden = false;
  $("shopUrl").value = catalog.shopUrl || "";
  $("publish").disabled = true;
  $("summary").textContent = "Published catalog loaded";
  renderProducts(); renderCollections(); renderProduct(); section("products");
  status("Ready to edit.");
  try {
    if (!localStorage.getItem("kir-studio-first-unlock") && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      localStorage.setItem("kir-studio-first-unlock", "1");
      $("workspace").animate([{opacity:0,transform:"translateY(12px)"},{opacity:1,transform:"translateY(0)"}], {duration:460,easing:"ease-out"});
    }
  } catch { /* Storage preferences never interrupt login. */ }
};
$("connection").onsubmit = async event => {
  event.preventDefault();
  const submit = event.target.querySelector("button");
  submit.disabled = true;
  credential = $("token").value.trim();
  $("token").value = "";
  try {
    status("Connecting to the repository…");
    branch = (await github("")).default_branch;
    const file = await github("/contents/catalog.json?ref=" + encodeURIComponent(branch));
    const bytes = Uint8Array.from(atob(file.content), c => c.charCodeAt(0));
    const latest = validateCatalog(JSON.parse(new TextDecoder().decode(bytes)));
    if (JSON.stringify(latest) !== initialCatalog) throw Error("The live catalog has changed. Your draft is still open. Copy your edits before reloading.");
    catalogSha = file.sha;
    $("connection").hidden = true;
    await $("publish").onclick();
  } catch (error) { credential = ""; problem(error); }
  finally { submit.disabled = false; }
};
$("search").oninput = renderProducts;
$("newProduct").onclick = () => { if (discardForm()) { renderProduct(); $("productName").focus(); } };
$("productForm").oninput = () => { formDirty = true; };
for (const nav of document.querySelectorAll("[data-view]")) nav.onclick = () => {
  if (nav.dataset.view !== "products" && formDirty) {
    if (!discardForm()) return;
    renderProduct(catalog.products.find(p => p.id === editingId));
  }
  section(nav.dataset.view);
};
async function encodeImage(file) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) throw Error("Select a JPEG, PNG or WebP image smaller than 8 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/webp", 0.86);
    const ext = dataUrl.startsWith("data:image/webp;") ? "webp" : "png";
    return {path: "media/upload-" + crypto.randomUUID() + "." + ext, dataUrl};
  } finally { bitmap.close(); }
}
$("upload").onchange = () => {
  const file = $("upload").files[0];
  const generation = ++uploadGeneration;
  selectedUpload = null;
  uploadFailure = false;
  if (!file) { uploadTask = null; return; }
  uploadTask = encodeImage(file).then(result => {
    if (generation !== uploadGeneration) return;
    selectedUpload = result;
    $("imageUrl").value = "";
    preview(result.dataUrl);
    status("Photo ready. Save the product to the draft.");
  }).catch(error => {
    if (generation !== uploadGeneration) return;
    uploadFailure = true;
    problem(error);
  });
};
$("imageUrl").oninput = () => {
  resetUpload();
  try { preview(imageSource($("imageUrl").value.trim())); } catch { preview(""); }
};
$("productForm").onsubmit = async event => {
  event.preventDefault();
  try {
    if (uploadTask) await uploadTask;
    if (uploadFailure) throw Error("Choose a valid image, or enter an image URL.");
    const name = $("productName").value.trim();
    if (!name || !$("collectionSelect").value) throw Error("Enter a product name and select a collection. Create a collection first if needed.");
    const checkoutUrl = $("checkoutUrl").value.trim();
    if (checkoutUrl && httpsUrl(checkoutUrl).hostname !== "buy.stripe.com") throw Error("Use a Stripe Payment Link beginning with https://buy.stripe.com/.");
    const image = selectedUpload?.path || imageSource($("imageUrl").value.trim());
    const existing = catalog.products.find(p => p.id === editingId);
    const item = {...existing, id: existing?.id ?? crypto.randomUUID(), name, price: $("price").value.trim(), description: $("description").value.trim(), collection: $("collectionSelect").value, image, checkoutUrl};
    if (selectedUpload) uploads.set(image, selectedUpload);
    if (existing) Object.assign(existing, item);
    else catalog.products.push(item);
    renderProducts(); renderProduct(item);
    changes("Product saved to draft. Publish to update the showroom.");
  } catch (error) { problem(error); }
};
$("deleteProduct").onclick = () => {
  const product = catalog.products.find(p => p.id === editingId);
  if (!product || !confirm("Remove “" + product.name + "” from the draft?")) return;
  catalog.products = catalog.products.filter(p => p !== product);
  renderProducts(); renderProduct(); changes("Product removed from draft.");
};
$("addCollection").onsubmit = event => {
  event.preventDefault();
  const name = $("collectionName").value.trim();
  if (!name || collectionExists(name)) return status("Choose a unique collection name.", true);
  catalog.collections.push({id: crypto.randomUUID(), name});
  $("collectionName").value = "";
  renderCollections(); renderProduct(catalog.products.find(p => p.id === editingId));
  changes("Collection added to draft.");
};
$("settings").onsubmit = event => {
  event.preventDefault();
  try {
    const value = $("shopUrl").value.trim();
    catalog.shopUrl = value ? httpsUrl(value).href : "";
    if ($("newPassword").value) catalog.studioPassword = $("newPassword").value;
    $("newPassword").value = "";
    changes("Settings saved to draft.");
  } catch (error) { problem(error); }
};
async function publish() {
  const refPath = branch.split("/").map(encodeURIComponent).join("/");
  const head = (await github("/git/ref/heads/" + refPath)).object.sha;
  const current = await github("/contents/catalog.json?ref=" + encodeURIComponent(head));
  if (current.sha !== catalogSha) throw Error("Another editor has published a newer catalog. Your draft remains in this tab. Copy your changes before reloading.");
  const commit = await github("/git/commits/" + head);
  const tree = [{path:"catalog.json", mode:"100644", type:"blob", content:JSON.stringify(catalog, null, 2) + "\n"}];
  const paths = new Set(catalog.products.map(p => p.image));
  for (const [path, upload] of uploads) {
    if (!paths.has(path)) continue;
    const blob = await github("/git/blobs", "POST", {encoding:"base64", content:upload.dataUrl.split(",")[1]});
    tree.push({path, mode:"100644", type:"blob", sha:blob.sha});
  }
  const treeResult = await github("/git/trees", "POST", {base_tree:commit.tree.sha, tree});
  const next = await github("/git/commits", "POST", {message:"Publish showroom catalog", tree:treeResult.sha, parents:[head]});
  await github("/git/refs/heads/" + refPath, "PATCH", {sha:next.sha, force:false});
  catalogSha = treeResult.tree.find(entry => entry.path === "catalog.json").sha;
}
$("publish").onclick = async () => {
  if (!dirty || saving) return;
  if (formDirty) return status("Save the product form to your draft before publishing.", true);
  if (!credential) {
    $("connection").hidden = false;
    $("token").focus();
    return status("Connect GitHub to publish this draft. Your edits are still here.");
  }
  saving = true;
  $("workspace").inert = true;
  status("Publishing your draft to GitHub…");
  try {
    await publish();
    dirty = false;
    uploads.clear();
    password = catalog.studioPassword ?? defaultPassword;
    $("publish").disabled = true;
    $("summary").textContent = "Published to GitHub";
    status("Published. The public showroom updates when GitHub Pages finishes deploying.");
  } catch (error) { problem(error); }
  finally { saving = false; $("workspace").inert = false; }
};
$("lock").onclick = () => {
  if ((dirty || formDirty) && !confirm("Lock the editor and discard unpublished changes?")) return;
  dirty = false; formDirty = false; credential = "";
  location.reload();
};
window.addEventListener("beforeunload", event => {
  if (dirty || formDirty || saving) { event.preventDefault(); event.returnValue = ""; }
});
start();
