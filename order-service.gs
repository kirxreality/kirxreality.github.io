const OWNER = "singernausicaa@gmail.com";
const CATALOG = "https://kirxreality.github.io/catalog.json";
function owner_() {
  if ((Session.getActiveUser().getEmail() || "").toLowerCase() !== OWNER) throw Error("Sign in with the KIR Google account to manage orders.");
}
function setup() {
  owner_();
  const props=PropertiesService.getScriptProperties();
  if (!props.getProperty("SHEET")) {
    const file=SpreadsheetApp.create("KIR â€¢ Private orders");
    const sheet=file.getSheets()[0];
    sheet.appendRow(["Request","Order","Created","Order details","Paid","Tracking ID","Email status","Revision"]);
    sheet.setFrozenRows(1);
    props.setProperty("SHEET",file.getId());
  }
  if (!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==="retryMail_")) ScriptApp.newTrigger("retryMail_").timeBased().everyHours(1).create();
}
function sheet_() {return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET")).getSheets()[0];}
function doGet(e) {
  const tpl=HtmlService.createTemplate(ORDER_PAGE_);
  tpl.admin=e.parameter.view==="orders";
  if(tpl.admin) owner_();
  tpl.cart=encodeURIComponent(e.parameter.cart || "[]").replace(/'/g,"%27");
  return tpl.evaluate().setTitle(tpl.admin?"KIR Â· Orders":"KIR Â· Place order").addMetaTag("viewport","width=device-width, initial-scale=1");
}
function quoteCart(cart) {
  if(!Array.isArray(cart)||!cart.length||cart.length>60) throw Error("Return to the showroom and choose your items.");
  const catalog=JSON.parse(UrlFetchApp.fetch(CATALOG).getContentText());
  const seen=new Set();
  const items=cart.map(line=>{
    const [id,qty]=line;
    const p=catalog.products.find(p=>p.id===id);
    if(!p || seen.has(id) || !Number.isInteger(qty)||qty<1||qty>99) throw Error("Your cart has changed. Please reopen it in the showroom.");
    seen.add(id);
    const cents=Math.round(Number(p.price)*100);
    if(!Number.isSafeInteger(cents)||cents<0||p.price==null||p.price==="") throw Error("A price is unavailable. Contact KIR.");
    return {name:p.name,sku:p.sku||"KIR-"+id.toUpperCase(),qty,cents};
  });
  return {items,total:items.reduce((sum,p)=>sum+p.qty*p.cents,0)};
}
function field_(value,max) {if(typeof value!=="string"||value.length>max) throw Error("Please check your contact details.");return value.trim();}
function placeOrder(input) {
  if(!/^[a-f0-9-]{36}$/.test(input.key)) throw Error("Please reopen checkout.");
  const customer={name:field_(input.name,120),address:field_(input.address,700),phone:field_(input.phone,35),email:field_(input.email,254)};
  if(!customer.name||!customer.address||(!customer.email&&!customer.phone)) throw Error("Enter a name, shipping address, and either phone or email.");
  if(customer.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw Error("Check your email address.");
  if(customer.phone&&!/^\+?[\d ().-]+$/.test(customer.phone) || customer.phone && !/^\d{7,15}$/.test(customer.phone.replace(/\D/g,""))) throw Error("Check your phone number.");
  const quote=quoteCart(input.cart);
  if(quote.total!==input.total) throw Error("Prices have changed. Reload checkout and review your total.");
  const lock=LockService.getScriptLock(); lock.waitLock(15000);
  try {
    const sh=sheet_();
    const hit=sh.getRange("A:A").createTextFinder(input.key).matchEntireCell(true).findNext();
    if(hit) return String(sh.getRange(hit.getRow(),2).getValue());
    const id="KIR-"+Utilities.getUuid().slice(0,12).toUpperCase();
    const order={customer,items:quote.items,total:quote.total};
    sh.appendRow([input.key,id,new Date().toISOString(),JSON.stringify(order),"Unpaid","","Pending",1]);
    SpreadsheetApp.flush();
    try {mail_(sh,sh.getLastRow(),id,order);} catch(e) {console.warn("Order notification queued");}
    return id;
  } finally {lock.releaseLock();}
}
function mail_(sh,row,id,o) {
  const c=o.customer;
  const body=[id,"UNPAID",...o.items.map(p=>p.sku+" | "+p.name+" Ã— "+p.qty+" | $"+(p.cents*p.qty/100).toFixed(2)),"Merchandise total: $"+(o.total/100).toFixed(2),"Name: "+c.name,"Address: "+c.address,"Phone: "+c.phone,"Email: "+c.email].join("\n");
  MailApp.sendEmail(notificationEmail_(),"New KIR order "+id,body);
  sh.getRange(row,7).setValue("Sent");
}
function retryMail_() {
  const lock=LockService.getScriptLock(); if(!lock.tryLock(3000)) return;
  try {const sh=sheet_();sh.getDataRange().getDisplayValues().slice(1).forEach((r,i)=>{if(r[6]==="Pending") mail_(sh,i+2,r[1],JSON.parse(r[3]));});} finally {lock.releaseLock();}
}
function listOrders() {
  owner_();return sheet_().getDataRange().getDisplayValues().slice(1).reverse().map(r=>({id:r[1],created:r[2],...JSON.parse(r[3]),paid:r[4]==="Paid",tracking:r[5],revision:Number(r[7])}));
}
function updateOrder(id,paid,tracking,revision) {
  owner_(); tracking=field_(tracking,100);
  if(typeof paid!=="boolean" || (tracking&&!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(tracking))) throw Error("Check the tracking ID.");
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try {const s=sheet_(),hit=s.getRange("B:B").createTextFinder(id).matchEntireCell(true).findNext();
    if(!hit) throw Error("Order unavailable.");
    const row=hit.getRow();
    if(s.getRange(row,8).getValue()!==revision) throw Error("Order changed in another tab. Reload before saving.");
    const columns=s.getRange(row,5,1,4);const values=columns.getValues()[0];
    s.getRange(row,6).setNumberFormat("@");
    columns.setValues([[paid?"Paid":"Unpaid",tracking,values[2],revision+1]]);
    SpreadsheetApp.flush();return revision+1;
  } finally {lock.releaseLock();}
}

function notificationEmail_() {
  return PropertiesService.getScriptProperties().getProperty("ORDER_EMAIL") || OWNER;
}
function getNotificationEmail() { owner_(); return notificationEmail_(); }
function saveNotificationEmail(email) {
  owner_();
  email=field_(email,254);
  if(!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) throw Error("Enter one valid notification email address.");
  PropertiesService.getScriptProperties().setProperty("ORDER_EMAIL",email);
  return email;
}

const ORDER_PAGE_ = "<!doctype html><html lang=\"en\"><head><base target=\"_top\"><meta charset=\"utf-8\"><style>\n*{box-sizing:border-box}body{margin:auto;max-width:750px;padding:26px 20px 80px;background:#f3efe7;color:#251e1d;font:16px/1.5 Arial,sans-serif}header{border-bottom:1px solid #b8aba0;padding-bottom:16px;font:bold italic 26px Georgia}h1{font:normal clamp(42px,8vw,78px)/1 Georgia;letter-spacing:-.065em}h2{font:normal 28px Georgia}label{display:block;margin:14px 0}input,textarea,button,.action{display:block;padding:12px;font:inherit;width:100%;border:1px solid #a59a90;background:white}button,.action{background:#512333;color:white;border:0;cursor:pointer;text-align:center;text-decoration:none;margin:8px 0}button:disabled{opacity:.55}article{background:#fffaf4;padding:20px;margin:16px 0}p{white-space:pre-line}input[type=checkbox]{width:auto;display:inline}a{color:inherit}#status{font-weight:bold}\n</style></head><body><header>KIR \u00d7 Reality</header><h1><?= admin ? \"Placed orders\" : \"Your order\" ?></h1><p id=\"status\" role=\"status\">Loading\u2026</p><main id=\"content\"></main>\n<script>\nconst main=document.querySelector(\"main\"),statusEl=document.querySelector(\"#status\");\nconst node=(tag,text)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;return el};\nconst money=n=>\"$\"+(n/100).toFixed(2);\nconst run=(method,...args)=>new Promise((yes,no)=>google.script.run.withSuccessHandler(yes).withFailureHandler(no)[method](...args));\nfunction field(form,label,name,type,required,max){const box=node(\"label\",label);const el=node(type===\"textarea\"?\"textarea\":\"input\");if(type!==\"textarea\")el.type=type;el.name=name;el.required=required;el.maxLength=max;box.append(el);form.append(box);return el}\nfunction lines(order){return order.items.map(i=>i.name+\" \u00d7 \"+i.qty+\" \u00b7 \"+i.sku+\" \u00b7 \"+money(i.qty*i.cents)).join(\"\\n\")+\"\\nMerchandise total \"+money(order.total)}\nfunction link(parent,label,url){const a=node(\"a\",label);a.className=\"action\";a.href=url;parent.append(a)}\nasync function checkout(){\n const cart=JSON.parse(decodeURIComponent('<?!= cart ?>'));\n const q=await run(\"quoteCart\",cart);statusEl.textContent=\"\";\n const summary=node(\"article\");summary.append(node(\"p\",lines(q)));main.append(summary);\n main.append(node(\"p\",\"No payment is collected today. KIR will contact you to confirm availability, shipping charges and payment before fulfillment.\"));\n const f=node(\"form\");main.append(f);\n field(f,\"Full name\",\"name\",\"text\",true,120).autocomplete=\"name\";\n field(f,\"Full shipping address, including postal code and country\",\"address\",\"textarea\",true,700).autocomplete=\"street-address\";\n f.append(node(\"p\",\"Enter a phone number or email so we can contact you.\"));\n field(f,\"Phone (include country code)\",\"phone\",\"tel\",false,35).autocomplete=\"tel\";\n field(f,\"Email\",\"email\",\"email\",false,254).autocomplete=\"email\";\n const submit=node(\"button\",\"Place order \u00b7 Pay later\");f.append(submit);\n const draftKey=\"kir-request:\"+JSON.stringify(cart);let key=crypto.randomUUID();\n try{key=sessionStorage.getItem(draftKey)||key;sessionStorage.setItem(draftKey,key)}catch{}\n f.onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(f));if(!data.phone.trim()&&!data.email.trim()){statusEl.textContent=\"Enter a phone number or email.\";return}\n submit.disabled=true;try{const id=await run(\"placeOrder\",{...data,key,cart,total:q.total});main.replaceChildren(node(\"h2\",\"Order received\"),node(\"p\",id+\" \u00b7 \"+money(q.total)+\" \u00b7 Unpaid\"),node(\"p\",\"KIR will contact you about payment and shipping.\"));link(main,\"Return to showroom\",\"https://kirxreality.github.io/\");statusEl.textContent=\"\";try{sessionStorage.removeItem(draftKey)}catch{}}catch(err){statusEl.textContent=err.message;submit.disabled=false}};\n}\nfunction draft(parent,label,c,body){\n if(c.phone){const phone=c.phone.replace(/[^\\d+]/g,\"\");const apple=/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);link(parent,\"Text \"+label,\"sms:\"+phone+(apple?\"&\":\"?\")+\"body=\"+encodeURIComponent(body))}\n if(c.email)link(parent,\"Email \"+label,\"mailto:\"+encodeURIComponent(c.email)+\"?subject=\"+encodeURIComponent(\"KIR order update\")+\"&body=\"+encodeURIComponent(body));\n}\nasync function orders(){\n const settings=node(\"form\"); settings.append(node(\"h2\",\"Order notifications\"));\n const recipient=field(settings,\"Send new order emails to\",\"recipient\",\"email\",true,254);\n recipient.value=await run(\"getNotificationEmail\");\n const saveEmail=node(\"button\",\"Save notification email\");settings.append(saveEmail);\n const note=node(\"p\");note.setAttribute(\"role\",\"status\");settings.append(note);main.append(settings);\n settings.onsubmit=async e=>{e.preventDefault();saveEmail.disabled=true;try{recipient.value=await run(\"saveNotificationEmail\",recipient.value);note.textContent=\"Notification email saved.\"}catch(err){note.textContent=err.message}finally{saveEmail.disabled=false}};\n const rows=await run(\"listOrders\");statusEl.textContent=rows.length?\"\":\"No orders yet.\";\n for(const o of rows){const card=node(\"article\");main.append(card);card.append(node(\"h2\",o.id),node(\"p\",o.created+\" \u00b7 \"+(o.paid?\"Paid\":\"Unpaid\")),node(\"p\",lines(o)),node(\"p\",[o.customer.name,o.customer.address,o.customer.phone,o.customer.email].filter(Boolean).join(\"\\n\")));\n const paid=field(card,\" Payment received \",\"paid\",\"checkbox\",false,10);paid.checked=o.paid;\n const track=field(card,\"Tracking ID\",\"tracking\",\"text\",false,100);track.value=o.tracking;\n const save=node(\"button\",\"Save status and tracking\");card.append(save);const result=node(\"p\");result.setAttribute(\"role\",\"status\");card.append(result);\n const messages=node(\"div\");card.append(messages);\n function refresh(){messages.replaceChildren();if(!o.paid)draft(messages,\"payment details\",o.customer,\"Hi \"+o.customer.name+\", this is KIR about order \"+o.id+\". Your merchandise total is \"+money(o.total)+\". Let's confirm shipping and arrange payment.\");\n if(o.tracking)draft(messages,\"shipping update\",o.customer,\"Hi \"+o.customer.name+\", your KIR order \"+o.id+\" has shipped. Your tracking ID is \"+o.tracking+\".\");}\n refresh();save.onclick=async()=>{save.disabled=true;const nextPaid=paid.checked,nextTrack=track.value.trim();try{o.revision=await run(\"updateOrder\",o.id,nextPaid,nextTrack,o.revision);o.paid=nextPaid;o.tracking=nextTrack;card.querySelector(\"p\").textContent=o.created+\" \u00b7 \"+(o.paid?\"Paid\":\"Unpaid\");refresh();result.textContent=\"Saved.\"}catch(err){result.textContent=err.message}finally{save.disabled=false}};}}\n(<?= admin ? \"orders\" : \"checkout\" ?>)().catch(err=>{statusEl.textContent=err.message});\n</script></body></html>\n";
