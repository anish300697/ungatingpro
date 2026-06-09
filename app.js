const fields = {
  marketplace: document.querySelector("#marketplace"),
  asin: document.querySelector("#asin"),
  productDescription: document.querySelector("#productDescription"),
  unitsPurchased: document.querySelector("#unitsPurchased"),
  supplierName: document.querySelector("#supplierName"),
  invoiceNumber: document.querySelector("#invoiceNumber"),
  invoiceDate: document.querySelector("#invoiceDate"),
  buyerName: document.querySelector("#buyerName"),
  billingAddress: document.querySelector("#billingAddress"),
  purchaseNotes: document.querySelector("#purchaseNotes"),
  proofFiles: document.querySelector("#proofFiles"),
  wordFiles: document.querySelector("#wordFiles"),
  photoFiles: document.querySelector("#photoFiles")
};

const uploadZones = {
  proofFiles: document.querySelector('label[for="proofFiles"]'),
  wordFiles: document.querySelector('label[for="wordFiles"]'),
  photoFiles: document.querySelector('label[for="photoFiles"]')
};

const els = {
  landingPage: document.querySelector("#landingPage"),
  convertPage: document.querySelector("#convertPage"),
  subscriptionPage: document.querySelector("#subscriptionPage"),
  couponPage: document.querySelector("#couponPage"),
  signInPage: document.querySelector("#signInPage"),
  forgotPasswordPage: document.querySelector("#forgotPasswordPage"),
  resetPasswordPage: document.querySelector("#resetPasswordPage"),
  entryPage: document.querySelector("#entryPage"),
  reviewPage: document.querySelector("#reviewPage"),
  checklist: document.querySelector("#checklist"),
  documentIndex: document.querySelector("#documentIndex"),
  fileCount: document.querySelector("#fileCount"),
  formStatus: document.querySelector("#formStatus"),
  mergeStatus: document.querySelector("#mergeStatus"),
  readinessTitle: document.querySelector("#readinessTitle"),
  readinessHint: document.querySelector("#readinessHint"),
  scoreRing: document.querySelector("#scoreRing"),
  packetStatus: document.querySelector("#packetStatus"),
  masterPacket: document.querySelector("#masterPacket"),
  documentOrderList: document.querySelector("#documentOrderList"),
  buildPacket: document.querySelector("#buildPacket"),
  printPacket: document.querySelector("#printPacket"),
  editPacket: document.querySelector("#editPacket"),
  homeLink: document.querySelector("#homeLink"),
  ungateBuilderLink: document.querySelector("#ungateBuilderLink"),
  convertLink: document.querySelector("#convertLink"),
  subscriptionLink: document.querySelector("#subscriptionLink"),
  signInLink: document.querySelector("#signInLink"),
  viewSubscription: document.querySelector("#viewSubscription"),
  startBuilder: document.querySelector("#startBuilder"),
  chooseMonthly: document.querySelector("#chooseMonthly"),
  chooseYearly: document.querySelector("#chooseYearly"),
  subscriptionStatus: document.querySelector("#subscriptionStatus"),
  selectedPlanName: document.querySelector("#selectedPlanName"),
  selectedBillingType: document.querySelector("#selectedBillingType"),
  couponCode: document.querySelector("#couponCode"),
  applyCoupon: document.querySelector("#applyCoupon"),
  continuePayment: document.querySelector("#continuePayment"),
  couponStatus: document.querySelector("#couponStatus"),
  wordFileList: document.querySelector("#wordFileList"),
  photoFileList: document.querySelector("#photoFileList"),
  convertWord: document.querySelector("#convertWord"),
  convertPhotos: document.querySelector("#convertPhotos"),
  wordConvertStatus: document.querySelector("#wordConvertStatus"),
  photoConvertStatus: document.querySelector("#photoConvertStatus"),
  downloadStatus: document.querySelector("#downloadStatus"),
  signInForm: document.querySelector("#signInForm"),
  createAccountForm: document.querySelector("#createAccountForm"),
  signInEmail: document.querySelector("#signInEmail"),
  signInPassword: document.querySelector("#signInPassword"),
  signInStatus: document.querySelector("#signInStatus"),
  createName: document.querySelector("#createName"),
  createEmail: document.querySelector("#createEmail"),
  createPassword: document.querySelector("#createPassword"),
  createAccountStatus: document.querySelector("#createAccountStatus"),
  forgotPasswordLink: document.querySelector("#forgotPasswordLink"),
  forgotPasswordForm: document.querySelector("#forgotPasswordForm"),
  resetEmail: document.querySelector("#resetEmail"),
  forgotPasswordStatus: document.querySelector("#forgotPasswordStatus"),
  resetPasswordForm: document.querySelector("#resetPasswordForm"),
  newPassword: document.querySelector("#newPassword"),
  confirmPassword: document.querySelector("#confirmPassword"),
  resetPasswordStatus: document.querySelector("#resetPasswordStatus"),
  accountPanel: document.querySelector("#accountPanel"),
  accountName: document.querySelector("#accountName"),
  accountEmail: document.querySelector("#accountEmail"),
  signOutButton: document.querySelector("#signOutButton")
};

let fileUrls = [];
let packetDocumentOrder = [];
let currentUser = null;
let resetToken = "";
let selectedPlan = JSON.parse(sessionStorage.getItem("selectedPlan") || "null");
let builderRequestedAfterLogin = sessionStorage.getItem("builderRequestedAfterLogin") === "true";
let couponRequestedAfterLogin = sessionStorage.getItem("couponRequestedAfterLogin") === "true";
let couponApplied = false;

const planDetails = {
  monthly: { planType: "monthly", planName: "Unlimited Generate", billingType: "Monthly", price: 9.99 },
  yearly: { planType: "yearly", planName: "Unlimited Generate", billingType: "Yearly", price: 96 }
};

const requiredEvidence = [
  {
    id: "invoice",
    title: "Commercial invoice is included",
    help: "Supplier invoice should show buyer, supplier, date, quantity, product, and invoice number.",
    test: (data) => hasFile(data.files, "invoice") || Boolean(data.invoiceNumber)
  },
  {
    id: "quantity",
    title: "Quantity meets marketplace expectation",
    help: "Most ungating reviews expect a clear unit count and matching product line item.",
    test: (data) => Number(data.unitsPurchased) >= 10
  },
  {
    id: "product",
    title: "Product identity is clear",
    help: "ASIN and description should match the purchased item.",
    test: (data) => data.asin.length >= 8 && data.productDescription.length >= 12
  },
  {
    id: "supplier",
    title: "Supplier relationship is documented",
    help: "Supplier name and delivery slips or photographs help show chain of custody.",
    test: (data) => data.supplierName.length >= 3 && data.files.length > 1
  },
  {
    id: "photos",
    title: "Supporting photographs are attached",
    help: "Photos of product labels, packaging, and received goods strengthen the packet.",
    test: (data) => data.files.some((file) => /image|photo|jpg|jpeg|png|webp|heic/i.test(file.type + file.name))
  }
];

function getData() {
  return {
    marketplace: fields.marketplace.value.trim(),
    asin: fields.asin.value.trim().toUpperCase(),
    productDescription: fields.productDescription.value.trim(),
    unitsPurchased: fields.unitsPurchased.value,
    supplierName: fields.supplierName.value.trim(),
    invoiceNumber: fields.invoiceNumber.value.trim(),
    invoiceDate: fields.invoiceDate.value,
    buyerName: fields.buyerName.value.trim(),
    billingAddress: fields.billingAddress.value.trim(),
    purchaseNotes: fields.purchaseNotes.value.trim(),
    files: Array.from(fields.proofFiles.files || [])
  };
}

function hasFile(files, needle) {
  return files.some((file) => file.name.toLowerCase().includes(needle));
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clearFileUrls() {
  fileUrls.forEach((url) => URL.revokeObjectURL(url));
  fileUrls = [];
}

function createFileUrl(file) {
  const url = URL.createObjectURL(file);
  fileUrls.push(url);
  return url;
}

function isImage(file) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|heic)$/i.test(file.name);
}

function isPdf(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isInvoice(file) {
  return /(invoice|receipt|sales|bill|purchase)/i.test(file.name);
}

function classifyFiles(files) {
  return {
    invoices: files.filter(isInvoice),
    photos: files.filter((file) => isImage(file) && !isInvoice(file)),
    other: files.filter((file) => !isInvoice(file) && !isImage(file))
  };
}

function defaultPacketDocuments(files) {
  const groups = classifyFiles(files);
  return [...groups.invoices, ...groups.photos, ...groups.other];
}

function fileKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function syncPacketDocumentOrder(files, preserveOrder = false) {
  const defaults = defaultPacketDocuments(files);
  if (!preserveOrder) {
    packetDocumentOrder = defaults;
    return;
  }

  const byKey = new Map(defaults.map((file) => [fileKey(file), file]));
  const kept = packetDocumentOrder
    .map((file) => byKey.get(fileKey(file)))
    .filter(Boolean);
  const keptKeys = new Set(kept.map(fileKey));
  const added = defaults.filter((file) => !keptKeys.has(fileKey(file)));
  packetDocumentOrder = [...kept, ...added];
}

function renderDocumentOrderControls() {
  if (!packetDocumentOrder.length) {
    els.documentOrderList.className = "document-order-list empty-state";
    els.documentOrderList.textContent = "No uploaded documents to arrange yet.";
    return;
  }

  els.documentOrderList.className = "document-order-list";
  els.documentOrderList.innerHTML = packetDocumentOrder
    .map((file, index) => {
      const size = `${Math.max(1, Math.round(file.size / 1024))} KB`;
      return `
        <div class="document-order-row">
          <div>
            <strong>${index + 1}. ${escapeHtml(file.name)}</strong>
            <span>${escapeHtml(file.type || "unknown")} · ${size}</span>
          </div>
          <div class="document-order-actions">
            <button type="button" data-action="up" data-index="${index}" ${index === 0 ? "disabled" : ""} title="Move up">&uarr;</button>
            <button type="button" data-action="down" data-index="${index}" ${index === packetDocumentOrder.length - 1 ? "disabled" : ""} title="Move down">&darr;</button>
          </div>
        </div>`;
    })
    .join("");
}

function movePacketDocument(index, direction) {
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= packetDocumentOrder.length) return;
  [packetDocumentOrder[index], packetDocumentOrder[nextIndex]] = [packetDocumentOrder[nextIndex], packetDocumentOrder[index]];
  buildMasterPacket(getData(), { preserveOrder: true });
}

function getPacketFileName(data) {
  const asin = (data.asin || "ASIN").replace(/[^A-Z0-9_-]/gi, "").toUpperCase() || "ASIN";
  return `${asin}_INVOICE`;
}

function buildChecklist(data) {
  const states = requiredEvidence.map((item) => ({ ...item, complete: item.test(data) }));
  els.checklist.innerHTML = states
    .map(
      (item) => `
        <li class="${item.complete ? "complete" : ""}">
          <span class="badge">${item.complete ? "OK" : "!"}</span>
          <div>
            <strong>${item.title}</strong>
            <p>${item.help}</p>
          </div>
        </li>`
    )
    .join("");

  const score = Math.round((states.filter((item) => item.complete).length / states.length) * 100);
  els.scoreRing.textContent = `${score}%`;
  els.readinessTitle.textContent = score >= 80 ? "Packet looks submission-ready" : score >= 50 ? "Packet needs a little more evidence" : "More proof needed";
  els.readinessHint.textContent =
    score >= 80
      ? "Scroll through the merged packet, verify everything, then click Save PDF at the bottom."
      : "The Master PDF Packet is visible below, but the checklist shows what still needs attention.";
  els.packetStatus.textContent = score >= 80 ? "Ready to review" : "Draft";
  els.formStatus.textContent = `${score}% readiness based on the information and files provided.`;
}

function buildDocumentIndex(data) {
  els.fileCount.textContent = `${data.files.length} ${data.files.length === 1 ? "file" : "files"} selected`;

  if (!data.files.length) {
    els.documentIndex.className = "document-index empty-state";
    els.documentIndex.textContent = "No files selected yet.";
    return;
  }

  els.documentIndex.className = "document-index";
  els.documentIndex.innerHTML = data.files
    .map((file, index) => {
      const type = file.type || "unknown";
      const size = `${Math.max(1, Math.round(file.size / 1024))} KB`;
      return `
        <div class="document-row">
          <strong>${index + 1}. ${file.name}</strong>
          <span>${type}</span>
          <span>${size}</span>
        </div>`;
    })
    .join("");
}

function buildSop(data) {
  const invoiceLine = data.invoiceNumber
    ? `The primary invoice referenced for this request is ${data.invoiceNumber}${data.invoiceDate ? `, dated ${data.invoiceDate}` : ""}.`
    : "The attached invoice is included as the primary purchase record for this request.";

  return `To Amazon Seller Support Team,

I am requesting approval to sell ASIN ${data.asin || "[ASIN]"}, described as ${data.productDescription || "[product description]"}. I purchased ${data.unitsPurchased || "[unit count]"} units from ${data.supplierName || "[supplier name]"} for resale through my business${data.buyerName ? `, ${data.buyerName}` : ""}.

${invoiceLine} I have attached the supporting supplier documentation, delivery evidence, and product photographs so your team can verify the purchase source, quantity, and product identity.

The documents in this packet are genuine purchase records and supporting proofs. They are organized to show the connection between the supplier, the purchased inventory, and the ASIN requested for approval.${data.billingAddress ? ` My business address for verification is ${data.billingAddress}.` : ""} ${data.purchaseNotes || "The invoice, shipment evidence, and photographs are intended to make the review straightforward and complete."}

Please review the attached packet and approve my account to list this product. I am happy to provide any additional documentation needed for verification.

Thank you,
${data.buyerName || "[Your business name]"}`;
}

function buildSopParts(data) {
  const invoiceLine = data.invoiceNumber
    ? `The primary invoice referenced for this request is ${data.invoiceNumber}${data.invoiceDate ? `, dated ${data.invoiceDate}` : ""}.`
    : "The attached invoice is included as the primary purchase record for this request.";

  return {
    title: "Ungating Approval Request",
    meta: [
      `ASIN: ${data.asin || "[ASIN]"}`,
      `Units: ${data.unitsPurchased || "[unit count]"}`,
      `Supplier: ${data.supplierName || "[supplier name]"}`,
      `Invoice: ${data.invoiceNumber || "[invoice number]"}`,
      `Business Address: ${data.billingAddress || "[business address]"}`
    ],
    paragraphs: [
      "To Amazon Seller Support Team,",
      `I am requesting approval to sell ASIN ${data.asin || "[ASIN]"}, described as ${data.productDescription || "[product description]"}. I purchased ${data.unitsPurchased || "[unit count]"} units from ${data.supplierName || "[supplier name]"} for resale through my business${data.buyerName ? `, ${data.buyerName}` : ""}.`,
      `${invoiceLine} I have attached the supporting supplier documentation, delivery evidence, and product photographs so your team can verify the purchase source, quantity, and product identity.`,
      `The documents in this packet are genuine purchase records and supporting proofs. They are organized to show the connection between the supplier, the purchased inventory, and the ASIN requested for approval.${data.billingAddress ? ` My business address for verification is ${data.billingAddress}.` : ""} ${data.purchaseNotes || "The invoice, shipment evidence, and photographs are intended to make the review straightforward and complete."}`,
      "Please review the attached packet and approve my account to list this product. I am happy to provide any additional documentation needed for verification.",
      `Thank you,\n${data.buyerName || "[Your business name]"}`
    ],
    footer: "Generated for marketplace ungating submission"
  };
}

function buildRequirementHighlights(data) {
  return [
    `Invoice or receipt should clearly show supplier name, buyer/business name, purchase date, product description, and quantity purchased.`,
    `Purchased units should support the approval request. Current unit count entered: ${escapeHtml(data.unitsPurchased || "[units]")}.`,
    `The ASIN and product description should match the invoice line item and photographs. Current ASIN: ${escapeHtml(data.asin || "[ASIN]")}.`,
    `Photographs should show the received product, packaging, label/UPC when available, and any visible brand/model details.`,
    `Documents should be genuine, unedited supplier proofs and should consistently connect supplier, buyer, product, and quantity.`
  ];
}

function renderSop(sop) {
  return sop
    .split("\n\n")
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function renderSopPage(data) {
  const sop = buildSopParts(data);
  return `
    <div class="letter-header">
      <h2>${escapeHtml(sop.title)}</h2>
      <div class="letter-rule"></div>
    </div>
    <div class="letter-meta">
      ${sop.meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
    </div>
    <div class="letter-body">
      ${sop.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("")}
    </div>
    <footer class="letter-footer">${escapeHtml(sop.footer)}</footer>
  `;
}

function renderFilePreview(file, index, typeLabel) {
  const url = createFileUrl(file);
  const name = escapeHtml(file.name);

  if (isImage(file)) {
    return `
      <figure class="packet-document">
        <figcaption>${name}</figcaption>
        <img src="${url}" alt="${name}" />
      </figure>`;
  }

  if (isPdf(file)) {
    return `
      <figure class="packet-document">
        <figcaption>${name}</figcaption>
        <object data="${url}" type="application/pdf">
          <p>${name}</p>
        </object>
      </figure>`;
  }

  return `
    <div class="packet-file-line">
      <strong>${typeLabel}</strong>
      <span>${name}</span>
    </div>`;
}

function renderFileSection(files, emptyMessage, typeLabel) {
  return files.length
    ? files.map((file, index) => renderFilePreview(file, index, typeLabel)).join("")
    : `<p class="empty-copy">${emptyMessage}</p>`;
}

function buildMasterPacket(data, options = {}) {
  clearFileUrls();
  syncPacketDocumentOrder(data.files, options.preserveOrder);
  renderDocumentOrderControls();

  els.masterPacket.innerHTML = `
    <section class="packet-section letter-page">
      ${renderSopPage(data)}
    </section>

    ${renderFileSection(packetDocumentOrder, "Upload documents to place them here.", "Document")}
  `;
}

function buildPacket(options = {}) {
  const data = getData();
  buildChecklist(data);
  buildDocumentIndex(data);
  buildMasterPacket(data, options);
  return data;
}

function showReviewPage(data) {
  els.landingPage.classList.add("is-hidden");
  els.convertPage.classList.add("is-hidden");
  els.subscriptionPage.classList.add("is-hidden");
  els.couponPage.classList.add("is-hidden");
  els.signInPage.classList.add("is-hidden");
  els.forgotPasswordPage.classList.add("is-hidden");
  els.resetPasswordPage.classList.add("is-hidden");
  els.entryPage.classList.add("is-hidden");
  els.reviewPage.classList.remove("is-hidden");
  els.mergeStatus.textContent = "";
  setActiveNav(null);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showEntryPage() {
  els.landingPage.classList.add("is-hidden");
  els.convertPage.classList.add("is-hidden");
  els.subscriptionPage.classList.add("is-hidden");
  els.couponPage.classList.add("is-hidden");
  els.signInPage.classList.add("is-hidden");
  els.forgotPasswordPage.classList.add("is-hidden");
  els.resetPasswordPage.classList.add("is-hidden");
  els.reviewPage.classList.add("is-hidden");
  els.entryPage.classList.remove("is-hidden");
  setActiveNav(els.ungateBuilderLink);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showLandingPage() {
  els.entryPage.classList.add("is-hidden");
  els.reviewPage.classList.add("is-hidden");
  els.convertPage.classList.add("is-hidden");
  els.subscriptionPage.classList.add("is-hidden");
  els.couponPage.classList.add("is-hidden");
  els.signInPage.classList.add("is-hidden");
  els.forgotPasswordPage.classList.add("is-hidden");
  els.resetPasswordPage.classList.add("is-hidden");
  els.landingPage.classList.remove("is-hidden");
  setActiveNav(null);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showConvertPage() {
  els.landingPage.classList.add("is-hidden");
  els.entryPage.classList.add("is-hidden");
  els.reviewPage.classList.add("is-hidden");
  els.subscriptionPage.classList.add("is-hidden");
  els.couponPage.classList.add("is-hidden");
  els.signInPage.classList.add("is-hidden");
  els.forgotPasswordPage.classList.add("is-hidden");
  els.resetPasswordPage.classList.add("is-hidden");
  els.convertPage.classList.remove("is-hidden");
  setActiveNav(els.convertLink);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showSubscriptionPage(message = "") {
  els.landingPage.classList.add("is-hidden");
  els.entryPage.classList.add("is-hidden");
  els.reviewPage.classList.add("is-hidden");
  els.convertPage.classList.add("is-hidden");
  els.couponPage.classList.add("is-hidden");
  els.signInPage.classList.add("is-hidden");
  els.forgotPasswordPage.classList.add("is-hidden");
  els.resetPasswordPage.classList.add("is-hidden");
  els.subscriptionPage.classList.remove("is-hidden");
  els.subscriptionStatus.textContent = message;
  setActiveNav(els.subscriptionLink);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showCouponPage() {
  const plan = selectedPlan || planDetails.monthly;
  els.landingPage.classList.add("is-hidden");
  els.entryPage.classList.add("is-hidden");
  els.reviewPage.classList.add("is-hidden");
  els.convertPage.classList.add("is-hidden");
  els.subscriptionPage.classList.add("is-hidden");
  els.signInPage.classList.add("is-hidden");
  els.forgotPasswordPage.classList.add("is-hidden");
  els.resetPasswordPage.classList.add("is-hidden");
  els.couponPage.classList.remove("is-hidden");
  els.selectedPlanName.textContent = plan.planName;
  els.selectedBillingType.textContent = `Billing type: ${plan.billingType}`;
  els.continuePayment.disabled = !couponApplied;
  setActiveNav(els.subscriptionLink);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showSignInPage() {
  els.landingPage.classList.add("is-hidden");
  els.entryPage.classList.add("is-hidden");
  els.reviewPage.classList.add("is-hidden");
  els.convertPage.classList.add("is-hidden");
  els.subscriptionPage.classList.add("is-hidden");
  els.couponPage.classList.add("is-hidden");
  els.forgotPasswordPage.classList.add("is-hidden");
  els.resetPasswordPage.classList.add("is-hidden");
  els.signInPage.classList.remove("is-hidden");
  setActiveNav(els.signInLink);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showForgotPasswordPage() {
  els.landingPage.classList.add("is-hidden");
  els.entryPage.classList.add("is-hidden");
  els.reviewPage.classList.add("is-hidden");
  els.convertPage.classList.add("is-hidden");
  els.subscriptionPage.classList.add("is-hidden");
  els.couponPage.classList.add("is-hidden");
  els.signInPage.classList.add("is-hidden");
  els.resetPasswordPage.classList.add("is-hidden");
  els.forgotPasswordPage.classList.remove("is-hidden");
  setActiveNav(els.signInLink);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showResetPasswordPage() {
  els.landingPage.classList.add("is-hidden");
  els.entryPage.classList.add("is-hidden");
  els.reviewPage.classList.add("is-hidden");
  els.convertPage.classList.add("is-hidden");
  els.subscriptionPage.classList.add("is-hidden");
  els.couponPage.classList.add("is-hidden");
  els.signInPage.classList.add("is-hidden");
  els.forgotPasswordPage.classList.add("is-hidden");
  els.resetPasswordPage.classList.remove("is-hidden");
  setActiveNav(els.signInLink);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setActiveNav(activeLink) {
  [els.ungateBuilderLink, els.convertLink, els.subscriptionLink, els.signInLink].forEach((link) => link?.classList.remove("is-active"));
  activeLink?.classList.add("is-active");
}

function hasActiveSubscription(user = currentUser) {
  if (!user) return false;
  return Boolean(
    user.hasActiveAccess ||
      user.hasFullAccess ||
      user.subscriptionStatus === "active" ||
      user.plan === "free_all" ||
      user.planType === "free_all" ||
      user.role === "admin" ||
      user.isMaster
  );
}

function openBuilder() {
  if (!currentUser) {
    builderRequestedAfterLogin = true;
    sessionStorage.setItem("builderRequestedAfterLogin", "true");
    navigateTo("/signin?redirect=builder");
    els.signInStatus.textContent = "Please sign in to use Ungate Builder.";
    return;
  }

  if (!hasActiveSubscription()) {
    navigateTo("/subscription?redirect=builder");
    return;
  }

  showEntryPage();
}

function getRedirectTarget() {
  return new URLSearchParams(window.location.search).get("redirect") || "";
}

function getBuilderDestination() {
  if (!currentUser) return "/signin?redirect=builder";
  if (!hasActiveSubscription()) return "/subscription?redirect=builder";
  return "/builder";
}

function navigateTo(path) {
  window.history.pushState(null, "", path);
  handleRoute();
}

function handleRoute() {
  const path = window.location.pathname;

  if (path === "/") {
    showLandingPage();
    return;
  }

  if (path === "/signin" || path === "/account") {
    showSignInPage();
    return;
  }

  if (path === "/forgot-password") {
    showForgotPasswordPage();
    return;
  }

  if (path === "/subscription") {
    const message = getRedirectTarget() === "builder" && currentUser && !hasActiveSubscription()
      ? "An active subscription is required to use Ungate Builder."
      : "";
    showSubscriptionPage(message);
    return;
  }

  if (path === "/coupon") {
    const planType = new URLSearchParams(window.location.search).get("plan");
    selectedPlan = planDetails[planType] || selectedPlan || planDetails.monthly;
    sessionStorage.setItem("selectedPlan", JSON.stringify(selectedPlan));
    showCouponPage();
    return;
  }

  if (path === "/reset-password") {
    resetToken = new URLSearchParams(window.location.search).get("token") || "";
    showResetPasswordPage();
    els.resetPasswordStatus.textContent = resetToken ? "" : "This password reset link is missing a token.";
    return;
  }

  if (path === "/builder") {
    openBuilder();
    return;
  }

  if (path === "/convert") {
    showConvertPage();
    return;
  }

  window.history.replaceState(null, "", "/");
  showLandingPage();
}

function downloadBlob(bytes, fileName) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getBaseName(fileName) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[^A-Z0-9_-]/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "CONVERTED";
}

function getConverterFileName(files, suffix) {
  if (!files.length) return suffix;
  const base = files.length === 1 ? getBaseName(files[0].name) : `MERGED_${files.length}_FILES`;
  return `${base}_${suffix}`;
}

function renderConverterList(files, target, emptyText) {
  if (!files.length) {
    target.className = "converter-list empty-state";
    target.textContent = emptyText;
    return;
  }

  target.className = "converter-list";
  target.innerHTML = files
    .map((file, index) => {
      const size = `${Math.max(1, Math.round(file.size / 1024))} KB`;
      return `
        <div class="converter-row">
          <strong>${index + 1}. ${escapeHtml(file.name)}</strong>
          <span>${escapeHtml(file.type || "unknown")}</span>
          <span>${size}</span>
        </div>`;
    })
    .join("");
}

function filesToDataTransfer(files) {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  return transfer;
}

function mergeInputFiles(input, droppedFiles) {
  const existing = Array.from(input.files || []);
  const incoming = Array.from(droppedFiles || []);
  const byKey = new Map([...existing, ...incoming].map((file) => [fileKey(file), file]));
  input.files = filesToDataTransfer(Array.from(byKey.values())).files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function setupDropZone(zone, input, acceptTest) {
  if (!zone || !input) return;

  ["dragenter", "dragover"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("is-dragover");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragover");
    });
  });

  zone.addEventListener("drop", (event) => {
    const dropped = Array.from(event.dataTransfer?.files || []).filter(acceptTest);
    if (!dropped.length) return;
    mergeInputFiles(input, dropped);
  });
}

function setupDragAndDrop() {
  setupDropZone(uploadZones.proofFiles, fields.proofFiles, (file) => /\.(pdf|png|jpe?g|heic|heif)$/i.test(file.name));
  setupDropZone(uploadZones.wordFiles, fields.wordFiles, (file) => /\.docx$/i.test(file.name));
  setupDropZone(uploadZones.photoFiles, fields.photoFiles, (file) => /\.(png|jpe?g|heic|heif)$/i.test(file.name));
}

function updateConverterLists() {
  renderConverterList(Array.from(fields.wordFiles.files || []), els.wordFileList, "No Word files selected yet.");
  renderConverterList(Array.from(fields.photoFiles.files || []), els.photoFileList, "No photos selected yet.");
}

async function buildPhotosPdfBytesWithBackend(files) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file, file.name));
  const endpoint = location.protocol === "file:" ? "http://127.0.0.1:8080/api/convert/photos" : "/api/convert/photos";

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      body: formData
    });
  } catch {
    throw new Error("Open Ungating Pro from the hosted website or start the Node server, then try again.");
  }

  if (!response.ok) {
    let message = "Photo conversion failed.";
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {
      message = await response.text();
    }
    throw new Error(message);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function buildWordPdfBytesWithBackend(files) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file, file.name));
  const endpoint = location.protocol === "file:" ? "http://127.0.0.1:8080/api/convert/word" : "/api/convert/word";

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      body: formData
    });
  } catch {
    throw new Error("Open Ungating Pro from the hosted website or start the Node server, then try again.");
  }


  if (!response.ok) {
    let message = "Word conversion failed.";
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {
      message = await response.text();
    }
    throw new Error(message);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function convertPhotosToPdf() {
  const files = Array.from(fields.photoFiles.files || []);
  if (!files.length) {
    els.photoConvertStatus.textContent = "Choose one or more JPG, PNG, or HEIC photos first.";
    return;
  }

  const fileName = getConverterFileName(files, "PHOTOS_TO_PDF");
  els.photoConvertStatus.textContent = `Building ${fileName}.pdf...`;

  try {
    const bytes = await buildPhotosPdfBytesWithBackend(files);
    downloadBlob(bytes, fileName);
    els.photoConvertStatus.textContent = `${fileName}.pdf downloaded.`;
  } catch (error) {
    console.error(error);
    els.photoConvertStatus.textContent = `Could not convert photos: ${error.message}`;
  }
}

async function convertWordToPdf() {
  const files = Array.from(fields.wordFiles.files || []);
  if (!files.length) {
    els.wordConvertStatus.textContent = "Choose one or more Word documents first.";
    return;
  }

  const fileName = getConverterFileName(files, "WORD_TO_PDF");
  els.wordConvertStatus.textContent = `Building ${fileName}.pdf...`;

  try {
    const bytes = await buildWordPdfBytesWithBackend(files);
    downloadBlob(bytes, fileName);
    els.wordConvertStatus.textContent = `${fileName}.pdf downloaded.`;
  } catch (error) {
    console.error(error);
    els.wordConvertStatus.textContent = `Could not convert Word files: ${error.message}`;
  }
}

function getResponseFileName(response, fallback) {
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  return (match?.[1] || `${fallback}.pdf`).replace(/\.pdf$/i, "");
}

async function buildMasterPdfWithBackend(data) {
  if (!hasActiveSubscription()) {
    throw new Error("An active subscription is required to generate ungating packets.");
  }

  syncPacketDocumentOrder(data.files, true);

  if (!packetDocumentOrder.length) {
    throw new Error("Upload at least one invoice, delivery slip, order confirmation, or product photo.");
  }

  const formData = new FormData();
  formData.append(
    "data",
    JSON.stringify({
      marketplace: data.marketplace,
      asin: data.asin,
      productDescription: data.productDescription,
      unitsPurchased: data.unitsPurchased,
      supplierName: data.supplierName,
      invoiceNumber: data.invoiceNumber,
      invoiceDate: data.invoiceDate,
      buyerName: data.buyerName,
      billingAddress: data.billingAddress,
      purchaseNotes: data.purchaseNotes
    })
  );
  packetDocumentOrder.forEach((file) => formData.append("files", file, file.name));

  const endpoint = location.protocol === "file:" ? "http://127.0.0.1:8080/api/generate-master-pdf" : "/api/generate-master-pdf";
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      body: formData
    });
  } catch {
    throw new Error("Open Ungating Pro from the hosted website or start the Node server, then try again.");
  }

  if (!response.ok) {
    let message = "PDF generation failed.";
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch {
      message = await response.text();
    }
    throw new Error(message);
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    fileName: getResponseFileName(response, "Ungating_Package")
  };
}

async function downloadPacketPdf() {
  const data = buildPacket({ preserveOrder: true });
  els.downloadStatus.textContent = "Building Ungating_Package.pdf...";

  try {
    const { bytes, fileName } = await buildMasterPdfWithBackend(data);
    downloadBlob(bytes, fileName);
    els.downloadStatus.textContent = `${fileName}.pdf downloaded.`;
  } catch (error) {
    console.error(error);
    els.downloadStatus.textContent = `Could not build the PDF: ${error.message}`;
  }
}

async function postJson(url, payload = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return parseJsonResponse(response);
}

async function parseJsonResponse(response) {
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload.error || payload.message || "Request failed.");
  }

  return payload;
}

function renderAccount(user) {
  currentUser = user;

  if (!user) {
    els.accountPanel.classList.add("is-hidden");
    els.signInLink.textContent = "Sign In";
    els.signInLink.href = "/signin";
    return;
  }

  els.accountPanel.classList.remove("is-hidden");
  els.accountName.textContent = user.name || "Account";
  els.accountEmail.textContent = user.email || "";
  els.signInLink.textContent = "Account";
  els.signInLink.href = "/account";
}

async function checkCurrentUser() {
  try {
    const payload = await parseJsonResponse(await fetch("/api/auth/me"));
    renderAccount(payload.user);
  } catch {
    renderAccount(null);
  }
}

async function handleSignIn(event) {
  event.preventDefault();
  els.signInStatus.textContent = "Signing in...";

  try {
    const payload = await postJson("/api/auth/sign-in", {
      email: els.signInEmail.value,
      password: els.signInPassword.value
    });
    els.signInForm.reset();
    els.signInStatus.textContent = "Signed in.";
    renderAccount(payload.user);
    continueAfterAuth(payload.user);
  } catch (error) {
    els.signInStatus.textContent = "Invalid email or password.";
    els.resetEmail.value = els.signInEmail.value;
  }
}

function continueAfterAuth(user) {
  if (couponRequestedAfterLogin || sessionStorage.getItem("couponRequestedAfterLogin") === "true") {
    couponRequestedAfterLogin = false;
    sessionStorage.removeItem("couponRequestedAfterLogin");
    const planType = selectedPlan?.planType || "monthly";
    navigateTo(`/coupon?plan=${encodeURIComponent(planType)}&redirect=builder`);
    return;
  }

  if (getRedirectTarget() === "builder") {
    if (hasActiveSubscription(user)) {
      navigateTo("/builder");
    } else {
      navigateTo("/subscription?redirect=builder");
    }
    return;
  }

  if (builderRequestedAfterLogin || sessionStorage.getItem("builderRequestedAfterLogin") === "true") {
    builderRequestedAfterLogin = false;
    sessionStorage.removeItem("builderRequestedAfterLogin");
    if (hasActiveSubscription(user)) {
      navigateTo("/builder");
    } else {
      navigateTo("/subscription?redirect=builder");
      els.subscriptionStatus.textContent = "An active subscription is required to use Ungate Builder.";
    }
  }
}

async function handleCreateAccount(event) {
  event.preventDefault();
  els.createAccountStatus.textContent = "Creating account...";

  try {
    const payload = await postJson("/api/auth/create-account", {
      name: els.createName.value,
      email: els.createEmail.value,
      password: els.createPassword.value
    });
    els.createAccountForm.reset();
    els.createAccountStatus.textContent = "Account created.";
    renderAccount(payload.user);
    continueAfterAuth(payload.user);
  } catch (error) {
    els.createAccountStatus.textContent = error.message;
  }
}

async function signOut() {
  try {
    await postJson("/api/auth/logout");
  } finally {
    currentUser = null;
    sessionStorage.clear();
    localStorage.removeItem("a2z_session");
    localStorage.removeItem("authToken");
    selectedPlan = null;
    couponApplied = false;
    renderAccount(null);
    clearFileUrls();
    fields.proofFiles.value = "";
    fields.wordFiles.value = "";
    fields.photoFiles.value = "";
    packetDocumentOrder = [];
    buildPacket();
    updateConverterLists();
    els.signInStatus.textContent = "Signed out.";
    window.history.replaceState(null, "", "/signin");
    showSignInPage();
  }
}

function selectSubscriptionPlan(planType) {
  selectedPlan = planDetails[planType] || planDetails.monthly;
  couponApplied = false;
  sessionStorage.setItem("selectedPlan", JSON.stringify(selectedPlan));
  els.couponCode.value = "";
  els.couponStatus.textContent = "";
  els.continuePayment.disabled = true;
  const redirect = getRedirectTarget() === "builder" ? "&redirect=builder" : "";
  navigateTo(`/coupon?plan=${encodeURIComponent(selectedPlan.planType)}${redirect}`);
}

async function applyCouponCode() {
  if (!currentUser) {
    couponRequestedAfterLogin = true;
    sessionStorage.setItem("couponRequestedAfterLogin", "true");
    navigateTo("/signin?redirect=builder");
    els.signInStatus.textContent = "Please sign in before applying a subscription coupon.";
    return;
  }

  const code = els.couponCode.value.trim();
  if (!code) {
    els.couponStatus.textContent = "Enter a coupon code.";
    return;
  }

  els.couponStatus.textContent = "Checking coupon...";

  try {
    const payload = await postJson("/api/apply-coupon", {
      code,
      planType: selectedPlan?.planType || "monthly"
    });
    couponApplied = true;
    els.continuePayment.disabled = false;
    els.couponStatus.textContent = payload.message || "Coupon applied successfully. Your subscription is now active.";
    await checkCurrentUser();
    navigateTo("/builder");
  } catch (error) {
    couponApplied = false;
    els.continuePayment.disabled = true;
    els.couponStatus.textContent = error.message || "Invalid coupon code.";
  }
}

function continueAfterCoupon() {
  if (!couponApplied) return;
  navigateTo("/builder");
}

async function requestPasswordReset(event) {
  event.preventDefault();
  els.forgotPasswordStatus.textContent = "Sending reset link...";

  try {
    const payload = await postJson("/api/auth/request-password-reset", {
      email: els.resetEmail.value
    });
    els.forgotPasswordStatus.textContent = payload.message || "If this email exists, a password reset link has been sent.";
  } catch (error) {
    els.forgotPasswordStatus.textContent = error.message;
  }
}

async function resetPassword(event) {
  event.preventDefault();
  els.resetPasswordStatus.textContent = "Updating password...";

  if (!resetToken) {
    els.resetPasswordStatus.textContent = "This password reset link is missing a token.";
    return;
  }

  if (els.newPassword.value !== els.confirmPassword.value) {
    els.resetPasswordStatus.textContent = "Passwords do not match.";
    return;
  }

  if (els.newPassword.value.length < 8) {
    els.resetPasswordStatus.textContent = "Password must be at least 8 characters.";
    return;
  }

  try {
    const payload = await postJson("/api/auth/reset-password", {
      token: resetToken,
      password: els.newPassword.value
    });
    els.resetPasswordForm.reset();
    resetToken = "";
    window.history.replaceState(null, "", "/signin");
    showSignInPage();
    els.signInStatus.textContent = payload.message || "Password updated successfully. Please sign in.";
  } catch (error) {
    els.resetPasswordStatus.textContent = error.message;
  }
}

els.buildPacket.addEventListener("click", () => {
  if (!hasActiveSubscription()) {
    navigateTo(getBuilderDestination());
    if (currentUser) {
      els.subscriptionStatus.textContent = "An active subscription is required to use Ungate Builder.";
    } else {
      els.signInStatus.textContent = "Please sign in to use Ungate Builder.";
    }
    return;
  }
  const data = buildPacket();
  showReviewPage(data);
});
els.printPacket.addEventListener("click", downloadPacketPdf);
els.editPacket.addEventListener("click", openBuilder);
els.homeLink.addEventListener("click", (event) => {
  event.preventDefault();
  navigateTo("/");
});
els.ungateBuilderLink.addEventListener("click", (event) => {
  event.preventDefault();
  navigateTo(getBuilderDestination());
});
els.convertLink.addEventListener("click", (event) => {
  event.preventDefault();
  navigateTo("/convert");
});
els.subscriptionLink.addEventListener("click", (event) => {
  event.preventDefault();
  navigateTo("/subscription");
});
els.chooseMonthly.addEventListener("click", () => selectSubscriptionPlan("monthly"));
els.chooseYearly.addEventListener("click", () => selectSubscriptionPlan("yearly"));
els.applyCoupon.addEventListener("click", applyCouponCode);
els.continuePayment.addEventListener("click", continueAfterCoupon);
els.signInLink.addEventListener("click", (event) => {
  event.preventDefault();
  navigateTo(currentUser ? "/account" : "/signin");
});
els.viewSubscription.addEventListener("click", (event) => {
  event.preventDefault();
  navigateTo("/subscription");
});
els.startBuilder.addEventListener("click", () => {
  navigateTo(getBuilderDestination());
});
els.signInForm.addEventListener("submit", handleSignIn);
els.createAccountForm.addEventListener("submit", handleCreateAccount);
els.signOutButton.addEventListener("click", signOut);
els.forgotPasswordLink.addEventListener("click", (event) => {
  event.preventDefault();
  els.resetEmail.value = els.signInEmail.value;
  navigateTo("/forgot-password");
});
els.forgotPasswordForm.addEventListener("submit", requestPasswordReset);
els.resetPasswordForm.addEventListener("submit", resetPassword);
els.convertWord.addEventListener("click", convertWordToPdf);
els.convertPhotos.addEventListener("click", convertPhotosToPdf);
fields.wordFiles.addEventListener("change", updateConverterLists);
fields.photoFiles.addEventListener("change", updateConverterLists);
els.documentOrderList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  movePacketDocument(Number(button.dataset.index), button.dataset.action);
});

Object.values(fields).forEach((field) => {
  field.addEventListener("input", buildPacket);
  field.addEventListener("change", buildPacket);
});

buildPacket();
updateConverterLists();
setupDragAndDrop();
window.addEventListener("popstate", handleRoute);

(async function initApp() {
  await checkCurrentUser();
  handleRoute();
})();
