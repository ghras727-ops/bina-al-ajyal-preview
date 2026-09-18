/**
 * app.js — منطق عرض بسيط بدون أي إطار عمل
 * يعتمد كليًا على البيانات الموجودة في data/materials.js
 * (المتغيرات العامة MATERIALS و PROJECTS يجب أن تكون محمّلة
 * قبل هذا الملف في كل صفحة).
 */

(function () {
  "use strict";

  /** إنشاء عنصر HTML مع خصائص ونص بسيط، لتفادي تكرار الكود */
  function el(tag, attrs, text) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        node.setAttribute(key, attrs[key]);
      });
    }
    if (text) {
      node.textContent = text;
    }
    return node;
  }

  /**
   * عدد الأيام التي تُعتبر خلالها المادة "جديدة" اعتمادًا على updatedAt.
   * ثابت واحد فقط يتحكم في هذه المدة في كل الموقع.
   */
  var NEW_ITEM_DAYS = 14;

  /** أسماء الأشهر الميلادية بالعربية لعرض تاريخ آخر تحديث */
  var ARABIC_MONTH_NAMES = [
    "يناير",
    "فبراير",
    "مارس",
    "أبريل",
    "مايو",
    "يونيو",
    "يوليو",
    "أغسطس",
    "سبتمبر",
    "أكتوبر",
    "نوفمبر",
    "ديسمبر",
  ];

  /**
   * يحاول تحويل قيمة updatedAt (المتوقع أن تكون نصًا مقبولاً من Date، مثل
   * ISO 8601) إلى كائن Date صالح. يعيد null لأي قيمة مفقودة أو غير صالحة،
   * حتى لا تُعرض تواريخ وهمية ولا يحدث خطأ في الصفحة.
   */
  function parseUpdatedAt(value) {
    if (!value) return null;
    var date = new Date(value);
    if (isNaN(date.getTime())) return null;
    return date;
  }

  /** ينسّق كائن Date بصيغة عربية واضحة، مثل: 17 سبتمبر 2026 */
  function formatArabicDate(date) {
    var day = date.getDate();
    var month = ARABIC_MONTH_NAMES[date.getMonth()];
    var year = date.getFullYear();
    return day + " " + month + " " + year;
  }

  /**
   * هل تُعتبر المادة "جديدة"؟ يعتمد فقط على وجود updatedAt صالح وكونه
   * خلال آخر NEW_ITEM_DAYS يومًا. لا علاقة له إطلاقًا بـ status أو
   * downloadUrl عمدًا.
   */
  function isRecentlyUpdated(date) {
    if (!date) return false;
    var msPerDay = 24 * 60 * 60 * 1000;
    var diffDays = (Date.now() - date.getTime()) / msPerDay;
    return diffDays >= 0 && diffDays <= NEW_ITEM_DAYS;
  }

  /** بناء بطاقة عرض للمشروع في الصفحة الرئيسية */
  function renderProjectShowcase(container) {
    if (!container) return;
    if (typeof PROJECTS === "undefined") {
      container.appendChild(
        el("p", { class: "data-error-message" }, "تعذر تحميل بيانات المشاريع حاليًا.")
      );
      return;
    }

    PROJECTS.forEach(function (project) {
      const card = el("article", { class: "project-card" });
      card.appendChild(el("h2", null, project.name));
      card.appendChild(el("p", null, project.description));

      const link = el(
        "a",
        {
          class: "btn btn--primary",
          href: "projects/" + project.slug + ".html",
        },
        "الانتقال إلى صفحة المشروع"
      );
      card.appendChild(link);
      container.appendChild(card);
    });
  }

  /**
   * مشاركة رابط مادة واحدة (title + الرابط المباشر لملفها كما هو في
   * item.downloadUrl، دون أي تعديل عليه). تُستخدم واجهة المشاركة الأصلية
   * للمتصفح (navigator.share) عند توفرها، وإلا تُعرض نافذة بديلة صغيرة
   * تحتوي على خيارات: نسخ الرابط، واتساب، تيليجرام، البريد الإلكتروني،
   * وإغلاق. لا يُستخدم أي API خارجي أو تخزين محلي أو عدّاد.
   */
  function shareMaterial(title, url) {
    if (navigator.share) {
      navigator.share({ title: title, url: url }).catch(function () {
        // تجاهل: المستخدم ألغى المشاركة أو حدث خطأ غير حرج من المتصفح.
      });
      return;
    }
    openShareFallback(title, url);
  }

  /**
   * إرجاع رابط الصفحة الحالية دون أي جزء Hash (#...)، للاستخدام في
   * مشاركة المشروع (رابط الصفحة نفسها) ومشاركة القسم (بعد إضافة
   * المعرّف الثابت الخاص بالقسم إليه).
   */
  function currentUrlWithoutHash() {
    return window.location.href.split("#")[0];
  }

  /**
   * صياغة نص مشاركة منظم لمشاركة المشروع أو القسم (عنوان، سطر تعريفي
   * بالمؤسسة، ثم الرابط في سطر مستقل). لا يُستخدم هذا النص في مشاركة
   * المواد الحالية، والتي تبقى كما هي دون أي تغيير.
   */
  function buildShareText(title, url) {
    return (
      title +
      "\n\n" +
      "من مشاريع وبرامج مؤسسة تنمية الشبابية الاجتماعية" +
      "\n\n" +
      "الرابط:\n" +
      url
    );
  }

  /**
   * مشاركة عامة لرابط صفحة مشروع أو رابط قسم عميق داخل صفحة مشروع،
   * بنص منظم. تستخدم navigator.share عند توفره، وإلا تعرض نافذة بديلة
   * منفصلة تمامًا عن نافذة مشاركة المواد (openShareFallback) حتى لا
   * تتأثر مشاركة المواد الحالية بأي شكل.
   */
  function shareGeneric(title, url, modalTitle) {
    if (navigator.share) {
      navigator
        .share({ title: title, text: buildShareText(title, url), url: url })
        .catch(function () {
          // تجاهل: المستخدم ألغى المشاركة أو حدث خطأ غير حرج من المتصفح.
        });
      return;
    }
    openGenericShareFallback(title, url, modalTitle);
  }

  /**
   * نافذة مشاركة بديلة لمشاركة المشروع أو القسم (منفصلة عن نافذة
   * مشاركة المواد). تعرض: نسخ الرابط، واتساب، تيليجرام، البريد
   * الإلكتروني، وإغلاق، بنفس شكل نافذة مشاركة المواد ونفس أنماط CSS.
   */
  function openGenericShareFallback(title, url, modalTitle) {
    const shareText = buildShareText(title, url);
    const encodedUrl = encodeURIComponent(url);
    const encodedShareText = encodeURIComponent(shareText);
    const encodedTitle = encodeURIComponent(title);
    const encodedTelegramText = encodeURIComponent(
      title + "\n\nمن مشاريع وبرامج مؤسسة تنمية الشبابية الاجتماعية"
    );

    const overlay = el("div", { class: "share-modal-overlay", role: "presentation" });
    const dialog = el("div", {
      class: "share-modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "generic-share-modal-title",
    });

    dialog.appendChild(el("h3", { id: "generic-share-modal-title" }, modalTitle || "مشاركة"));

    const list = el("div", { class: "share-modal-options" });

    const copyBtn = el("button", { type: "button", class: "btn btn--secondary share-modal-option" }, "نسخ الرابط");
    copyBtn.addEventListener("click", function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(
          function () {
            copyBtn.textContent = "تم نسخ الرابط";
          },
          function () {
            copyBtn.textContent = "تعذر نسخ الرابط";
          }
        );
      } else {
        copyBtn.textContent = "تعذر نسخ الرابط";
      }
    });
    list.appendChild(copyBtn);

    const whatsappLink = el(
      "a",
      {
        class: "btn btn--secondary share-modal-option",
        href: "https://wa.me/?text=" + encodedShareText,
        target: "_blank",
        rel: "noopener noreferrer",
      },
      "واتساب"
    );
    list.appendChild(whatsappLink);

    const telegramLink = el(
      "a",
      {
        class: "btn btn--secondary share-modal-option",
        href: "https://t.me/share/url?url=" + encodedUrl + "&text=" + encodedTelegramText,
        target: "_blank",
        rel: "noopener noreferrer",
      },
      "تيليجرام"
    );
    list.appendChild(telegramLink);

    const emailLink = el(
      "a",
      {
        class: "btn btn--secondary share-modal-option",
        href: "mailto:?subject=" + encodedTitle + "&body=" + encodedShareText,
      },
      "البريد الإلكتروني"
    );
    list.appendChild(emailLink);

    dialog.appendChild(list);

    const closeBtn = el("button", { type: "button", class: "btn btn--primary share-modal-close" }, "إغلاق");
    function closeModal() {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      document.removeEventListener("keydown", onKeydown);
    }
    function onKeydown(evt) {
      if (evt.key === "Escape") {
        closeModal();
      }
    }
    closeBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", function (evt) {
      if (evt.target === overlay) {
        closeModal();
      }
    });
    document.addEventListener("keydown", onKeydown);

    dialog.appendChild(closeBtn);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    closeBtn.focus();
  }

  /**
   * بناء زر "مشاركة المشروع" وإلحاقه بمقدمة صفحة المشروع، إن وُجدت.
   * يستخدم رابط صفحة المشروع الحالي نفسه كما هو (بلا رابط وسيط وبلا أي
   * تعديل على الـ slug)، مع اسم المشروع من PROJECTS إن توفر.
   */
  function addProjectShareButton(projectSlug) {
    if (!projectSlug) return;
    const introContainer = document.querySelector(".page-intro .container");
    if (!introContainer) return;

    let projectName = projectSlug;
    if (typeof PROJECTS !== "undefined" && Array.isArray(PROJECTS)) {
      const found = PROJECTS.filter(function (p) {
        return p.slug === projectSlug;
      })[0];
      if (found && found.name) {
        projectName = found.name;
      }
    }

    const wrap = el("div", { class: "project-share-wrap" });
    const btn = el(
      "button",
      {
        type: "button",
        class: "btn btn--secondary btn--share-project",
        "aria-label": "مشاركة المشروع: " + projectName,
      },
      "مشاركة المشروع"
    );
    btn.addEventListener("click", function () {
      shareGeneric(projectName, currentUrlWithoutHash(), "مشاركة المشروع");
    });
    wrap.appendChild(btn);
    introContainer.appendChild(wrap);
  }

  /**
   * تحويل اسم قسم إلى مُعرّف ثابت وصالح للاستخدام في URL (يُستخدم في
   * الرابط العميق لمشاركة القسم وفي id عنصر القسم نفسه). المعرّف مشتق
   * بالكامل من اسم القسم، فهو ثابت ولا يتغير عند إعادة تحميل الصفحة
   * ولا يعتمد على أي رقم عشوائي أو ترتيب.
   */
  function slugifySectionName(name) {
    let slug = String(name || "")
      .trim()
      .replace(/\s+/g, "-");
    slug = slug.replace(/[^A-Za-z0-9\u0600-\u06FF\-_]/g, "");
    slug = slug.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
    if (!slug) {
      slug = "section";
    }
    return slug;
  }

  /**
   * مدة إبراز بطاقة مادة مؤقتًا (بالمللي ثانية) عند الوصول إليها عبر
   * رابط عميق #material-<id>. ثابت واحد يتحكم بهذه المدة.
   */
  var MATERIAL_HIGHLIGHT_MS = 2500;

  /**
   * إبراز بطاقة مادة بصريًا لفترة قصيرة، بإضافة صنف CSS يُزال تلقائيًا
   * بعد MATERIAL_HIGHLIGHT_MS. لا يغيّر أي بيانات ولا يفتح أي رابط.
   */
  function highlightMaterialCardTemporarily(materialEl) {
    materialEl.classList.remove("material-card--highlighted");
    // إعادة تشغيل حركة الإبراز حتى لو كانت البطاقة نفسها مُبرَزة سابقًا
    // خلال نفس الجلسة (مثلاً بحث متكرر عن المادة نفسها).
    void materialEl.offsetWidth;
    materialEl.classList.add("material-card--highlighted");
    window.setTimeout(function () {
      materialEl.classList.remove("material-card--highlighted");
    }, MATERIAL_HIGHLIGHT_MS);
  }

  /**
   * فتح القسم الذي تنتمي إليه مادة محدَّدة (إن وُجد ضمن Accordion)،
   * إغلاق أي قسم آخر مفتوح، ثم الانتقال داخل الصفحة إلى بطاقة المادة
   * نفسها وإبرازها مؤقتًا. تعمل أيضًا مع المواد غير المصنَّفة ضمن أي
   * قسم (تُعرض مباشرة بلا Accordion): في هذه الحالة يُكتفى بالانتقال
   * إلى البطاقة وإبرازها دون أي محاولة فتح قسم غير موجود أصلاً.
   */
  function openMaterialFromHash(targetId, controllers) {
    const materialEl = document.getElementById(targetId);
    if (!materialEl) return;

    const panel = materialEl.closest(".accordion-panel");
    if (panel && controllers && controllers.length) {
      let matchedController = null;
      controllers.forEach(function (controller) {
        if (controller.panel === panel) {
          matchedController = controller;
        }
      });
      if (matchedController) {
        controllers.forEach(function (controller) {
          setAccordionItemOpen(controller, controller === matchedController);
        });
      }
    }

    window.requestAnimationFrame(function () {
      materialEl.scrollIntoView({ behavior: "smooth", block: "center" });
      highlightMaterialCardTemporarily(materialEl);
    });
  }

  /**
   * فتح القسم المطابق لمعرّف موجود في Hash الرابط الحالي عند تحميل
   * الصفحة تلقائيًا، والانتقال إليه داخل الصفحة، دون فتح أي قسم آخر.
   * إذا لم يوجد معرّف مطابق، تبقى الصفحة بحالتها الطبيعية (كل الأقسام
   * مغلقة) بلا أي تأثير إضافي.
   */
  function openSectionFromHash(targetId, controllers) {
    let target = null;
    controllers.forEach(function (controller) {
      if (controller.item.id === targetId) {
        target = controller;
      }
    });
    if (!target) return;

    controllers.forEach(function (controller) {
      setAccordionItemOpen(controller, controller === target);
    });

    window.requestAnimationFrame(function () {
      target.item.scrollIntoView({ behavior: "smooth", block: "start" });
      if (typeof target.button.focus === "function") {
        try {
          target.button.focus({ preventScroll: true });
        } catch (err) {
          target.button.focus();
        }
      }
    });
  }

  /**
   * نقطة الدخول الموحّدة للروابط العميقة عند تحميل صفحة مشروع: تُقرأ
   * قيمة Hash الحالية وتُوجَّه حسب بادئتها إلى فتح قسم (#section-...)
   * أو فتح مادة داخل قسمها مع إبرازها (#material-...). لا تُغيّر أي
   * رابط Archive ولا تفتح أي ملف تلقائيًا في أي من الحالتين.
   */
  function openDeepLinkFromHash(controllers) {
    const hash = window.location.hash;
    if (!hash || hash.length < 2) return;

    let targetId;
    try {
      targetId = decodeURIComponent(hash.slice(1));
    } catch (err) {
      targetId = hash.slice(1);
    }

    if (targetId.indexOf("material-") === 0) {
      openMaterialFromHash(targetId, controllers);
      return;
    }

    openSectionFromHash(targetId, controllers);
  }

  /** بناء وعرض نافذة المشاركة البديلة عند غياب دعم navigator.share. */
  function openShareFallback(title, url) {
    const encodedUrl = encodeURIComponent(url);
    const encodedTitle = encodeURIComponent(title);

    const overlay = el("div", { class: "share-modal-overlay", role: "presentation" });
    const dialog = el("div", {
      class: "share-modal",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "share-modal-title",
    });

    dialog.appendChild(el("h3", { id: "share-modal-title" }, "مشاركة المادة"));

    const list = el("div", { class: "share-modal-options" });

    const copyBtn = el("button", { type: "button", class: "btn btn--secondary share-modal-option" }, "نسخ الرابط");
    copyBtn.addEventListener("click", function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(
          function () {
            copyBtn.textContent = "تم نسخ الرابط";
          },
          function () {
            copyBtn.textContent = "تعذر نسخ الرابط";
          }
        );
      } else {
        copyBtn.textContent = "تعذر نسخ الرابط";
      }
    });
    list.appendChild(copyBtn);

    const whatsappLink = el(
      "a",
      {
        class: "btn btn--secondary share-modal-option",
        href: "https://wa.me/?text=" + encodedTitle + "%20" + encodedUrl,
        target: "_blank",
        rel: "noopener noreferrer",
      },
      "واتساب"
    );
    list.appendChild(whatsappLink);

    const telegramLink = el(
      "a",
      {
        class: "btn btn--secondary share-modal-option",
        href: "https://t.me/share/url?url=" + encodedUrl + "&text=" + encodedTitle,
        target: "_blank",
        rel: "noopener noreferrer",
      },
      "تيليجرام"
    );
    list.appendChild(telegramLink);

    const emailLink = el(
      "a",
      {
        class: "btn btn--secondary share-modal-option",
        href: "mailto:?subject=" + encodedTitle + "&body=" + encodedUrl,
      },
      "البريد الإلكتروني"
    );
    list.appendChild(emailLink);

    dialog.appendChild(list);

    const closeBtn = el("button", { type: "button", class: "btn btn--primary share-modal-close" }, "إغلاق");
    function closeModal() {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      document.removeEventListener("keydown", onKeydown);
    }
    function onKeydown(evt) {
      if (evt.key === "Escape") {
        closeModal();
      }
    }
    closeBtn.addEventListener("click", closeModal);
    overlay.addEventListener("click", function (evt) {
      if (evt.target === overlay) {
        closeModal();
      }
    });
    document.addEventListener("keydown", onKeydown);

    dialog.appendChild(closeBtn);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    closeBtn.focus();
  }

  /**
   * بناء بطاقة عرض واحدة لمادة.
   * المواد المتاحة (status !== "pending") تحتفظ بالسلوك المعتمد سابقًا:
   * زرا "تحميل الملف" و"قراءة الملف" يفتحان في تبويب جديد.
   * المواد "pending" تُعرض بعنوانها فقط مع عبارة توضح أنها قيد التجهيز،
   * بلا أي رابط أو زر تحميل فعّال، وبمظهر مختلف واضح حتى لا تبدو
   * كأن الرابط يعمل.
   */
  function buildMaterialCard(item) {
    const isPending = item.status === "pending";

    const cardClass = isPending
      ? "material-card material-card--pending"
      : "material-card";
    // معرّف ثابت للبطاقة مبني من material.id كما هو (بلا أي تعديل أو
    // رقم عشوائي)، يُستخدم كرابط عميق لهذه المادة تحديدًا: #material-<id>.
    // يُترك بلا id إن لم تملك المادة قيمة id أصلاً، دون أي خطأ.
    const cardAttrs = { class: cardClass };
    if (item.id) {
      cardAttrs.id = "material-" + item.id;
    }
    const card = el("article", cardAttrs);

    // رأس البطاقة: العنوان مع شارة "جديد" بجانبه إن كانت المادة محدَّثة
    // حديثًا. تظهر الشارة اعتمادًا فقط على updatedAt (بغض النظر عن status
    // أو downloadUrl)، لذلك تُبنى هنا قبل أي تفرّع لاحق بين مادة متاحة
    // ومادة "قيد التجهيز".
    const updatedAtDate = parseUpdatedAt(item.updatedAt);
    const header = el("div", { class: "material-card-header" });
    header.appendChild(el("h3", null, item.title));
    if (isRecentlyUpdated(updatedAtDate)) {
      header.appendChild(el("span", { class: "new-badge" }, "جديد"));
    }
    card.appendChild(header);

    if (item.description) {
      card.appendChild(el("p", null, item.description));
    }

    const meta = el("div", { class: "material-meta" });
    meta.appendChild(el("span", null, "النوع: " + item.fileType));
    if (item.fileSize) {
      meta.appendChild(el("span", null, "الحجم: " + item.fileSize));
    }
    // تاريخ آخر تحديث: يُعرض فقط إذا توفرت قيمة updatedAt صالحة للمادة.
    // المواد القديمة بلا updatedAt تُعرض بشكل طبيعي بدون هذا السطر.
    if (updatedAtDate) {
      meta.appendChild(
        el("span", null, "آخر تحديث: " + formatArabicDate(updatedAtDate))
      );
    }
    card.appendChild(meta);

    if (isPending) {
      // لا يوجد رابط حقيقي بعد: لا نضيف أي عنصر <a>، ولا نبني رابطًا
      // وهميًا. نكتفي بشارة حالة ونص توضيحي، حتى لا تبدو البطاقة وكأن
      // التحميل متاح.
      card.appendChild(
        el("span", { class: "status-badge status-badge--pending" }, "قيد التجهيز")
      );
      card.appendChild(
        el(
          "p",
          { class: "pending-note" },
          "المادة قيد التجهيز وستتوفر قريبًا."
        )
      );
      return card;
    }

    // مادة متاحة (status !== "pending") لكن بلا رابط تنزيل صالح: لا نبني
    // روابط <a href=""> مكسورة، ولا زر مشاركة. نكتفي برسالة نصية واضحة،
    // بنفس أسلوب رسالة حالة "قيد التجهيز" (class: pending-note) كمرجع.
    if (!item.downloadUrl) {
      card.appendChild(
        el("p", { class: "pending-note" }, "الرابط غير متوفر حاليًا")
      );
      return card;
    }

    const actions = el("div", { class: "material-actions" });

    // زر "تحميل الملف" — رابط مباشر إلى ملف PDF (item.downloadUrl كما هو)،
    // بدون أي صفحة وسيطة أو صفحة بحث أو صفحة تفاصيل. يفتح في تبويب جديد
    // (target="_blank" + rel="noopener noreferrer")، حتى يبقى تبويب الموقع
    // الأصلي مفتوحًا ولا يغادر الزائر التطبيق. لا يُعتمد على خاصية download
    // وحدها لأن المتصفحات تتجاهلها مع روابط خارجية من نطاق مختلف مثل
    // Internet Archive.
    const downloadBtn = el(
      "a",
      {
        class: "btn btn--primary",
        href: item.downloadUrl,
        target: "_blank",
        rel: "noopener noreferrer",
      },
      "تحميل الملف"
    );
    actions.appendChild(downloadBtn);

    // زر "قراءة الملف" — يفتح نفس الرابط المباشر في تبويب جديد
    const readBtn = el(
      "a",
      {
        class: "btn btn--secondary",
        href: item.downloadUrl,
        target: "_blank",
        rel: "noopener noreferrer",
      },
      "قراءة الملف"
    );
    actions.appendChild(readBtn);

    // زر "مشاركة" — يظهر فقط للمواد المتاحة التي تملك رابط تنزيل صالح
    // (item.downloadUrl). يشارك الرابط المباشر للملف نفسه كما هو، دون أي
    // تعديل عليه ودون أي رابط وسيط لصفحة المشروع أو الصفحة.
    if (item.downloadUrl) {
      const shareBtn = el(
        "button",
        {
          type: "button",
          class: "btn btn--secondary btn--share",
        },
        "مشاركة"
      );
      shareBtn.addEventListener("click", function () {
        shareMaterial(item.title, item.downloadUrl);
      });
      actions.appendChild(shareBtn);
    }

    card.appendChild(actions);

    card.appendChild(
      el(
        "p",
        { class: "download-note" },
        "قد يفتح الملف في نفس التبويب أو في تبويب جديد بدل التنزيل التلقائي، حسب إعدادات المتصفح المستخدم. لو أردت العودة إلى الموقع بعد ذلك استخدم زر الرجوع في المتصفح."
      )
    );

    return card;
  }

  /**
   * حساب إحصاءات المكتبة (المشاريع، الأقسام، المواد، المتاحة، قيد
   * التجهيز) اعتمادًا فقط على المتغيرات الموجودة في data/materials.js.
   * لا يُنشئ أي نسخة موازية من البيانات ولا يحسب أي شيء غير مطلوب
   * (لا زيارات، لا قراءات، لا تنزيلات). يُعيد null إذا لم تكن البيانات
   * الأساسية (PROJECTS أو MATERIALS) جاهزة كمصفوفات صالحة.
   */
  function computeLibraryStats() {
    if (typeof PROJECTS === "undefined" || !Array.isArray(PROJECTS)) {
      return null;
    }
    if (typeof MATERIALS === "undefined" || !Array.isArray(MATERIALS)) {
      return null;
    }

    const projectsCount = PROJECTS.length;
    const materialsCount = MATERIALS.length;
    const availableCount = MATERIALS.filter(function (m) {
      return m.status === "available";
    }).length;
    const pendingCount = MATERIALS.filter(function (m) {
      return m.status === "pending";
    }).length;

    // الأقسام: تُحسب من SECTIONS عند وجودها وعدم كونها فارغة، مع إزالة
    // التكرار حسب مجموعة (المشروع + اسم القسم). إن لم توجد SECTIONS أو
    // كانت فارغة، تُحسب بدلاً من ذلك من قيمة section داخل كل مادة في
    // MATERIALS، مع إزالة التكرار حسب القيمة نفسها.
    let sectionsCount;
    if (typeof SECTIONS !== "undefined" && Array.isArray(SECTIONS) && SECTIONS.length > 0) {
      const seenSections = {};
      let uniqueCount = 0;
      SECTIONS.forEach(function (s) {
        const key = (s.project || "") + "||" + (s.name || "");
        if (!seenSections[key]) {
          seenSections[key] = true;
          uniqueCount += 1;
        }
      });
      sectionsCount = uniqueCount;
    } else {
      const seenNames = {};
      let uniqueCount2 = 0;
      MATERIALS.forEach(function (m) {
        if (m.section && !seenNames[m.section]) {
          seenNames[m.section] = true;
          uniqueCount2 += 1;
        }
      });
      sectionsCount = uniqueCount2;
    }

    return {
      projects: projectsCount,
      sections: sectionsCount,
      materials: materialsCount,
      available: availableCount,
      pending: pendingCount,
    };
  }

  /**
   * عرض بطاقة "إحصاءات المكتبة" في الحاوية المعطاة، بالاعتماد كليًا على
   * computeLibraryStats. عند تعذر حساب الإحصاءات (بيانات غير جاهزة أو
   * خطأ غير متوقع)، تُعرض عبارة توضيحية بدل أي أرقام وهمية أو أصفار
   * غير حقيقية، ولا يتوقف تنفيذ باقي الصفحة.
   */
  function renderLibraryStats(container) {
    if (!container) return;

    let stats = null;
    try {
      stats = computeLibraryStats();
    } catch (err) {
      stats = null;
    }

    if (!stats) {
      container.classList.add("stats-card--error");
      container.appendChild(
        el("p", { class: "stats-error-message" }, "تعذر تحميل إحصاءات المكتبة حاليًا.")
      );
      return;
    }

    container.appendChild(el("h2", { class: "stats-card-title" }, "إحصاءات المكتبة"));

    const grid = el("dl", { class: "stats-grid" });
    const entries = [
      { label: "المشاريع", value: stats.projects },
      { label: "الأقسام", value: stats.sections },
      { label: "المواد", value: stats.materials },
      { label: "المواد المتاحة", value: stats.available },
      { label: "المواد قيد التجهيز", value: stats.pending },
    ];

    entries.forEach(function (entry) {
      const item = el("div", { class: "stat-item" });
      item.appendChild(el("dd", { class: "stat-value" }, String(entry.value)));
      item.appendChild(el("dt", { class: "stat-label" }, entry.label));
      grid.appendChild(item);
    });

    container.appendChild(grid);
  }

  /**
   * عدد التحديثات المعروضة كحد أقصى في قسم "آخر التحديثات" بالصفحة
   * الرئيسية. ثابت واحد يتحكم بهذا الحد.
   */
  var RECENT_UPDATES_LIMIT = 5;

  /**
   * يحسب أحدث المواد تحديثًا اعتمادًا فقط على updatedAt الصالحة في
   * MATERIALS، دون أي تعديل على البيانات الأصلية. المواد بلا updatedAt،
   * أو التي تحمل قيمة updatedAt غير صالحة، تُستبعد بصمت دون إيقاف
   * الصفحة (parseUpdatedAt تُرجع null لهذه الحالات). النتيجة مرتّبة من
   * الأحدث إلى الأقدم، ومقصورة على أول "limit" عنصرًا.
   */
  function computeRecentUpdates(limit) {
    if (typeof MATERIALS === "undefined" || !Array.isArray(MATERIALS)) return [];

    var withDates = [];
    MATERIALS.forEach(function (m) {
      var date = parseUpdatedAt(m.updatedAt);
      if (date) {
        withDates.push({ material: m, date: date });
      }
    });

    withDates.sort(function (a, b) {
      return b.date.getTime() - a.date.getTime();
    });

    return withDates.slice(0, limit);
  }

  /**
   * عرض قسم "آخر التحديثات" في الحاوية المعطاة بالاعتماد كليًا على
   * computeRecentUpdates. القسم بأكمله مبني كعنصر Accordion واحد (بنفس
   * أسلوب Accordion المستخدم في أقسام المشروع: زر حقيقي، aria-expanded،
   * aria-controls، منطقة مواد مطوية افتراضيًا)، مغلق افتراضيًا عند
   * تحميل الصفحة حتى لا يغطي على قائمة المشاريع تحته. عنوان الزر يعرض
   * "آخر التحديثات" مع عدد التحديثات الفعلي بين قوسين، دون أي رقم وهمي.
   * كل عنصر داخل القائمة المفتوحة يعرض عنوان المادة، اسم المشروع، اسم
   * القسم، تاريخ آخر تحديث بصيغة عربية، وزر "فتح التحديث" الذي يستخدم
   * نفس نظام الروابط العميقة الحالي (projects/<slug>.html#material-<id>)
   * المستخدم أصلاً في نتائج البحث، دون أي تعديل على project slug أو
   * material id أو section name. عند عدم وجود أي مادة بـ updatedAt صالح
   * تُعرض عبارة توضيحية بدل القائمة داخل نفس المنطقة القابلة للطي، ولا
   * يتوقف تنفيذ باقي الصفحة عند أي خطأ غير متوقع.
   */
  function renderRecentUpdates(container) {
    if (!container) return;

    var recent = [];
    try {
      recent = computeRecentUpdates(RECENT_UPDATES_LIMIT);
    } catch (err) {
      recent = [];
    }

    var buttonId = "recent-updates-trigger";
    var panelId = "recent-updates-panel";

    var accordionItem = el("div", { class: "accordion-item recent-updates-accordion-item" });

    var heading = el("h2", { class: "accordion-heading" });
    var button = el("button", {
      type: "button",
      class: "accordion-trigger",
      id: buttonId,
      "aria-expanded": "false",
      "aria-controls": panelId,
    });

    button.appendChild(el("span", { class: "accordion-title" }, "آخر التحديثات"));

    var meta = el("span", { class: "accordion-meta" });
    meta.appendChild(el("span", { class: "accordion-count" }, "(" + recent.length + ")"));
    meta.appendChild(el("span", { class: "accordion-icon", "aria-hidden": "true" }));
    button.appendChild(meta);

    heading.appendChild(button);
    accordionItem.appendChild(heading);

    var panel = el("div", {
      class: "accordion-panel",
      id: panelId,
      role: "region",
      "aria-labelledby": buttonId,
      "aria-hidden": "true",
    });

    var inner = el("div", { class: "accordion-panel-inner" });

    if (!recent.length) {
      inner.appendChild(
        el("p", { class: "recent-updates-empty" }, "لا توجد تحديثات حديثة حاليًا.")
      );
    } else {
      var list = el("div", { class: "recent-updates-list" });

      recent.forEach(function (entry) {
        var item = entry.material;
        var project = findProjectBySlug(item.project);
        var projectName = project ? project.name : item.project;

        var card = el("article", { class: "recent-update-item" });
        card.appendChild(el("h3", { class: "recent-update-title" }, item.title));

        var itemMeta = el("div", { class: "recent-update-meta" });
        itemMeta.appendChild(el("span", null, "المشروع: " + projectName));
        if (item.section) {
          itemMeta.appendChild(el("span", null, "القسم: " + item.section));
        }
        itemMeta.appendChild(el("span", null, "آخر تحديث: " + formatArabicDate(entry.date)));
        card.appendChild(itemMeta);

        // نفس صيغة الرابط العميق المستخدمة في نتائج البحث تمامًا
        // (siteSearchResultHref لمادة تملك id): projects/<slug>.html#material-<id>.
        // يفتح صفحة المشروع، فتُشغَّل openDeepLinkFromHash تلقائيًا هناك
        // لفتح القسم الصحيح والانتقال إلى بطاقة المادة وإبرازها مؤقتًا.
        if (item.project && item.id) {
          var href = "projects/" + item.project + ".html#material-" + item.id;
          card.appendChild(
            el(
              "a",
              { class: "btn btn--secondary recent-update-open-btn", href: href },
              "فتح التحديث"
            )
          );
        }

        list.appendChild(card);
      });

      inner.appendChild(list);
    }

    panel.appendChild(inner);
    accordionItem.appendChild(panel);

    // الحالة الابتدائية: القسم مغلق دائمًا عند تحميل الصفحة، ومحتواه غير
    // قابل للوصول عبر لوحة المفاتيح حتى يُفتح، تمامًا كأقسام المشروع.
    disablePanelFocus(panel);

    var controller = { button: button, panel: panel };
    button.addEventListener("click", function () {
      var isOpen = button.getAttribute("aria-expanded") === "true";
      setAccordionItemOpen(controller, !isOpen);
    });

    container.appendChild(accordionItem);
  }

  /**
   * صياغة عدد المواد بشكل موجز ("5 مواد"، "1 مادة"، "0 مواد")، لعرضه
   * إلى جانب عنوان كل قسم في الـ Accordion.
   */
  function materialsCountLabel(count) {
    if (count === 1) return "1 مادة";
    return String(count) + " مواد";
  }

  /**
   * تجميع مواد قسم واحد حسب "track" (تجميع ثابت غير تفاعلي، كما كان
   * معتمدًا سابقًا)، وإلحاقها داخل الحاوية المعطاة. المواد التي لا تملك
   * track تُعرض مباشرة بلا عنوان مسار.
   */
  function appendSectionMaterials(container, sectionItems) {
    const trackOrder = [];
    const trackGroups = {};
    const noTrackItems = [];

    sectionItems.forEach(function (item) {
      if (item.track) {
        if (!trackGroups[item.track]) {
          trackGroups[item.track] = [];
          trackOrder.push(item.track);
        }
        trackGroups[item.track].push(item);
      } else {
        noTrackItems.push(item);
      }
    });

    const listWrap = el("div", { class: "material-section" });

    noTrackItems.forEach(function (item) {
      listWrap.appendChild(buildMaterialCard(item));
    });

    trackOrder.forEach(function (trackName) {
      const trackWrap = el("div", { class: "material-track" });
      trackWrap.appendChild(el("h3", { class: "track-heading" }, trackName));
      trackGroups[trackName].forEach(function (item) {
        trackWrap.appendChild(buildMaterialCard(item));
      });
      listWrap.appendChild(trackWrap);
    });

    container.appendChild(listWrap);
  }

  /**
   * تعطيل قابلية التركيز (Tab) لأي رابط أو زر داخل منطقة قسم مغلقة، مع
   * حفظ قيمة tabindex الأصلية (إن وُجدت) لاستعادتها عند إعادة الفتح.
   * هذا يمنع وصول لوحة المفاتيح إلى مواد قسم مغلق دون التأثير على أي
   * بيانات أو عناصر أخرى.
   */
  function disablePanelFocus(panel) {
    const focusables = panel.querySelectorAll("a[href], button, [tabindex]");
    focusables.forEach(function (node) {
      if (!node.hasAttribute("data-accordion-had-tabindex")) {
        node.setAttribute(
          "data-accordion-had-tabindex",
          node.hasAttribute("tabindex") ? node.getAttribute("tabindex") : ""
        );
      }
      node.setAttribute("tabindex", "-1");
    });
  }

  /** استعادة قابلية التركيز الأصلية لعناصر منطقة قسم أُعيد فتحها. */
  function enablePanelFocus(panel) {
    const focusables = panel.querySelectorAll("[data-accordion-had-tabindex]");
    focusables.forEach(function (node) {
      const original = node.getAttribute("data-accordion-had-tabindex");
      if (original === "") {
        node.removeAttribute("tabindex");
      } else {
        node.setAttribute("tabindex", original);
      }
      node.removeAttribute("data-accordion-had-tabindex");
    });
  }

  /** بناء عنصر Accordion واحد (زر القسم + منطقة مواده) دون فتحه. */
  function buildAccordionItem(descriptor, index, projectSlug, sectionId) {
    const buttonId = "accordion-trigger-" + projectSlug + "-" + index;
    const panelId = "accordion-panel-" + projectSlug + "-" + index;

    const item = el("div", { class: "accordion-item", id: sectionId });

    const heading = el("h2", { class: "accordion-heading" });
    const button = el("button", {
      type: "button",
      class: "accordion-trigger",
      id: buttonId,
      "aria-expanded": "false",
      "aria-controls": panelId,
    });

    button.appendChild(el("span", { class: "accordion-title" }, descriptor.name));

    const meta = el("span", { class: "accordion-meta" });
    meta.appendChild(
      el("span", { class: "accordion-count" }, materialsCountLabel(descriptor.materials.length))
    );
    meta.appendChild(el("span", { class: "accordion-icon", "aria-hidden": "true" }));
    button.appendChild(meta);

    heading.appendChild(button);

    // زر "مشاركة القسم" — عنصر مستقل داخل عنوان القسم نفسه (وليس داخل
    // زر فتح/إغلاق القسم)، حتى لا يتعارض مع طيّ القسم عند الضغط عليه.
    // يستخدم رابطًا عميقًا ثابتًا لصفحة المشروع نفسها مع معرّف القسم.
    const shareBtn = el(
      "button",
      {
        type: "button",
        class: "accordion-share-btn",
        "aria-label": "مشاركة قسم: " + descriptor.name,
      },
      "مشاركة"
    );
    shareBtn.addEventListener("click", function (evt) {
      evt.stopPropagation();
      const sectionUrl = currentUrlWithoutHash() + "#" + sectionId;
      shareGeneric(descriptor.name, sectionUrl, "مشاركة القسم");
    });
    heading.appendChild(shareBtn);

    item.appendChild(heading);

    const panel = el("div", {
      class: "accordion-panel",
      id: panelId,
      role: "region",
      "aria-labelledby": buttonId,
      "aria-hidden": "true",
    });

    const inner = el("div", { class: "accordion-panel-inner" });

    if (descriptor.description) {
      inner.appendChild(el("p", { class: "accordion-description" }, descriptor.description));
    }

    if (descriptor.materials.length === 0) {
      inner.appendChild(
        el("p", { class: "empty-state" }, "لا توجد مواد مضافة إلى هذا القسم حاليًا.")
      );
    } else {
      appendSectionMaterials(inner, descriptor.materials);
    }

    panel.appendChild(inner);
    item.appendChild(panel);

    // الحالة الابتدائية: القسم مغلق دائمًا، ومواده غير قابلة للوصول عبر
    // لوحة المفاتيح حتى يُفتح.
    disablePanelFocus(panel);

    return { item: item, button: button, panel: panel };
  }

  /** تبديل حالة فتح/إغلاق عنصر Accordion واحد، مع تحديث aria-expanded. */
  function setAccordionItemOpen(controller, isOpen) {
    controller.button.setAttribute("aria-expanded", isOpen ? "true" : "false");
    controller.panel.classList.toggle("is-open", isOpen);
    if (isOpen) {
      controller.panel.removeAttribute("aria-hidden");
      enablePanelFocus(controller.panel);
    } else {
      controller.panel.setAttribute("aria-hidden", "true");
      disablePanelFocus(controller.panel);
    }
  }

  /**
   * بناء Accordion كامل لأقسام مشروع واحد، وإلحاقه بالحاوية. قسم واحد
   * فقط يبقى مفتوحًا في الوقت نفسه: فتح أي قسم يُغلق كل الأقسام الأخرى،
   * والضغط على القسم المفتوح نفسه يُغلقه.
   */
  function renderAccordion(container, sectionDescriptors, projectSlug) {
    const wrap = el("div", { class: "accordion" });
    const controllers = [];
    const usedSectionIds = {};

    sectionDescriptors.forEach(function (descriptor, index) {
      const baseId = "section-" + slugifySectionName(descriptor.name);
      let sectionId = baseId;
      let suffix = 2;
      while (usedSectionIds[sectionId]) {
        sectionId = baseId + "-" + suffix;
        suffix += 1;
      }
      usedSectionIds[sectionId] = true;

      const built = buildAccordionItem(descriptor, index, projectSlug, sectionId);
      controllers.push(built);
      wrap.appendChild(built.item);
    });

    controllers.forEach(function (controller) {
      controller.button.addEventListener("click", function () {
        const isOpen = controller.button.getAttribute("aria-expanded") === "true";
        controllers.forEach(function (other) {
          if (other !== controller) {
            setAccordionItemOpen(other, false);
          }
        });
        setAccordionItemOpen(controller, !isOpen);
      });
    });

    container.appendChild(wrap);

    return controllers;
  }

  /** بناء قائمة المواد الخاصة بمشروع محدد، مع عرض أقسامها كـ Accordion. */
  function renderMaterialList(container, projectSlug) {
    if (!container) return;
    if (typeof MATERIALS === "undefined") {
      container.appendChild(
        el("p", { class: "data-error-message" }, "تعذر تحميل مواد هذا المشروع حاليًا.")
      );
      return;
    }

    const items = MATERIALS.filter(function (m) {
      return m.project === projectSlug;
    });

    // بيانات الأقسام الوصفية (الاسم، الوصف، الترتيب) إن وُجد ملف SECTIONS
    // ضمن data/materials.js لهذا المشروع. هذا الحقل اختياري تمامًا: أي
    // بيانات قديمة بلا SECTIONS تستمر بالعمل عبر ترتيب ظهور الأقسام في
    // المواد نفسها.
    const projectSections =
      typeof SECTIONS !== "undefined"
        ? SECTIONS.filter(function (s) {
            return s.project === projectSlug;
          })
        : [];

    if (items.length === 0 && projectSections.length === 0) {
      const empty = el(
        "p",
        { class: "empty-state" },
        "لا توجد مواد متاحة حاليًا ضمن هذا المشروع."
      );
      container.appendChild(empty);
      return;
    }

    // المواد التي لا تملك حقل "section" تُعرض بالطريقة القديمة المسطّحة
    // (بلا أي عنوان قسم وبلا Accordion)، حفاظًا على التوافق مع أي بيانات
    // قديمة لا تستخدم هذا الحقل. المواد التي تملك "section" تُجمع تحت
    // اسم قسمها، بترتيب ظهور كل قسم لأول مرة داخل مصفوفة MATERIALS.
    const unsectioned = [];
    const sectionOrder = [];
    const sectionGroups = {};

    items.forEach(function (item) {
      if (item.section) {
        if (!sectionGroups[item.section]) {
          sectionGroups[item.section] = [];
          sectionOrder.push(item.section);
        }
        sectionGroups[item.section].push(item);
      } else {
        unsectioned.push(item);
      }
    });

    unsectioned.forEach(function (item) {
      container.appendChild(buildMaterialCard(item));
    });

    // أي قسم مُعرَّف في SECTIONS لهذا المشروع ولا يملك أي مادة بعد يُضاف
    // أيضًا، ليظهر في الـ Accordion بعدد مواد صفر بدل أن يختفي بلا سبب.
    const sectionMetaByName = {};
    projectSections.forEach(function (s) {
      sectionMetaByName[s.name] = s;
      if (!sectionGroups[s.name]) {
        sectionGroups[s.name] = [];
        sectionOrder.push(s.name);
      }
    });

    if (sectionOrder.length === 0) {
      openDeepLinkFromHash([]);
      return;
    }

    // ترتيب الأقسام: يُعتمد حقل "order" من SECTIONS عند توفره لكل الأقسام
    // القابلة للمقارنة به، وإلا يُحافظ على ترتيب ظهور القسم لأول مرة.
    const sectionDescriptors = sectionOrder.map(function (name, idx) {
      const meta = sectionMetaByName[name];
      return {
        name: name,
        description: meta && meta.description ? meta.description : "",
        order: meta && typeof meta.order === "number" ? meta.order : null,
        insertionIndex: idx,
        materials: sectionGroups[name],
      };
    });

    sectionDescriptors.sort(function (a, b) {
      const aHas = a.order !== null;
      const bHas = b.order !== null;
      if (aHas && bHas) return a.order - b.order || a.insertionIndex - b.insertionIndex;
      if (aHas) return -1;
      if (bHas) return 1;
      return a.insertionIndex - b.insertionIndex;
    });

    const controllers = renderAccordion(container, sectionDescriptors, projectSlug);
    openDeepLinkFromHash(controllers);
  }

  /* ==============================================================
   * بحث فوري عام في الصفحة الرئيسية (المرحلة الأولى فقط)
   * ==============================================================
   * يعمل بالكامل من المتغيرات العامة المحمّلة أصلاً في الصفحة
   * (PROJECTS، SECTIONS، MATERIALS من data/materials.js دون أي تعديل
   * عليها)، بلا أي طلب شبكة أو API أو قاعدة بيانات أو localStorage.
   * فهرس البحث يُبنى مرة واحدة فقط عند أول استخدام ويُحفظ في متغيّر
   * داخل هذا الملف طوال عمر الصفحة (وليس بين تحميلات الصفحة).
   */

  var SEARCH_MIN_CHARS = 3;
  var SEARCH_MAX_RESULTS = 8;
  var SEARCH_DEBOUNCE_MS = 200;

  var siteSearchIndexCache = null;

  /** إيجاد بيانات مشروع عبر slug من PROJECTS، أو null إن لم يوجد. */
  function findProjectBySlug(slug) {
    if (typeof PROJECTS === "undefined" || !Array.isArray(PROJECTS)) return null;
    for (var i = 0; i < PROJECTS.length; i++) {
      if (PROJECTS[i].slug === slug) return PROJECTS[i];
    }
    return null;
  }

  /**
   * بناء فهرس بحث مسطّح من PROJECTS وSECTIONS وMATERIALS كما هي، دون
   * أي تعديل على بياناتها الأصلية. كل عنصر في الفهرس يمثّل نتيجة بحث
   * محتملة واحدة (مشروع، أو قسم، أو مادة) مع كل حقولها النصية القابلة
   * للبحث فيها (بما فيها previewUrl وdownloadUrl للفهرسة فقط، دون أي
   * نية لعرضهما لاحقًا في نتائج البحث).
   */
  function buildSiteSearchIndex() {
    var index = [];

    if (typeof PROJECTS !== "undefined" && Array.isArray(PROJECTS)) {
      PROJECTS.forEach(function (p) {
        index.push({
          type: "project",
          title: p.name || "",
          projectSlug: p.slug || "",
          projectName: p.name || "",
          sectionName: null,
          description: p.description || "",
          secondary: [p.slug || ""],
        });
      });
    }

    if (typeof SECTIONS !== "undefined" && Array.isArray(SECTIONS)) {
      SECTIONS.forEach(function (s) {
        var project = findProjectBySlug(s.project);
        index.push({
          type: "section",
          title: s.name || "",
          projectSlug: s.project || "",
          projectName: project ? project.name : "",
          sectionName: s.name || "",
          description: s.description || "",
          secondary: [],
        });
      });
    }

    if (typeof MATERIALS !== "undefined" && Array.isArray(MATERIALS)) {
      MATERIALS.forEach(function (m) {
        var project = findProjectBySlug(m.project);
        index.push({
          type: "material",
          title: m.title || "",
          projectSlug: m.project || "",
          projectName: project ? project.name : "",
          sectionName: m.section || null,
          materialId: m.id || null,
          description: m.description || "",
          secondary: [
            m.track || "",
            m.fileType || "",
            m.id || "",
            m.previewUrl || "",
            m.downloadUrl || "",
          ],
        });
      });
    }

    return index;
  }

  /** يعيد فهرس البحث، ويبنيه مرة واحدة فقط عند أول استدعاء. */
  function getSiteSearchIndex() {
    if (!siteSearchIndexCache) {
      siteSearchIndexCache = buildSiteSearchIndex();
    }
    return siteSearchIndexCache;
  }

  /** تطبيع نص للمقارنة أثناء البحث (نص فارغ إذا كانت القيمة غير موجودة) */
  function normalizeSearchText(value) {
    return String(value || "").toLowerCase();
  }

  /**
   * يحسب مرتبة تطابق عنصر فهرس مع نص بحث مُطبَّع مسبقًا (q، بلا مسافات
   * زائدة). ترتيب الأولوية:
   * 1) تطابق العنوان تمامًا.
   * 2) العنوان يبدأ بالنص المكتوب.
   * 3) العنوان يحتوي النص في أي موضع آخر (امتداد منطقي لتطابق العنوان).
   * 4) اسم المشروع أو اسم القسم يحتوي النص.
   * 5) الوصف أو أي حقل ثانوي (track، fileType، id، previewUrl،
   *    downloadUrl) يحتوي النص.
   * يعيد null إن لم يوجد أي تطابق في أي حقل.
   */
  function scoreSiteSearchEntry(entry, q) {
    var title = normalizeSearchText(entry.title);

    if (title === q) return 1;
    if (title.indexOf(q) === 0) return 2;
    if (title.indexOf(q) !== -1) return 3;

    var projectName = normalizeSearchText(entry.projectName);
    var sectionName = entry.sectionName ? normalizeSearchText(entry.sectionName) : "";
    if (projectName.indexOf(q) !== -1 || (sectionName && sectionName.indexOf(q) !== -1)) {
      return 4;
    }

    var description = normalizeSearchText(entry.description);
    if (description.indexOf(q) !== -1) return 5;

    var secondaryHit = (entry.secondary || []).some(function (val) {
      var normalized = normalizeSearchText(val);
      return normalized && normalized.indexOf(q) !== -1;
    });
    if (secondaryHit) return 5;

    return null;
  }

  /**
   * بحث كامل عبر فهرس الموقع. يعيد مصفوفة نتائج مرتّبة حسب الأولوية
   * (كل عنصر: {entry, score})، أو مصفوفة فارغة إذا كان النص أقصر من
   * الحد الأدنى (SEARCH_MIN_CHARS) أو بلا أي تطابق.
   */
  function runSiteSearch(rawQuery) {
    var q = normalizeSearchText(rawQuery).trim();
    if (q.length < SEARCH_MIN_CHARS) return [];

    var index = getSiteSearchIndex();
    var results = [];
    index.forEach(function (entry, i) {
      var score = scoreSiteSearchEntry(entry, q);
      if (score !== null) {
        results.push({ entry: entry, score: score, originalIndex: i });
      }
    });

    results.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      return a.originalIndex - b.originalIndex;
    });

    return results;
  }

  /** تسمية عربية لنوع نتيجة بحث واحدة */
  function siteSearchTypeLabel(type) {
    if (type === "project") return "مشروع";
    if (type === "section") return "قسم";
    return "مادة";
  }

  /**
   * يبني رابط الانتقال المناسب عند اختيار نتيجة بحث:
   * - مشروع: صفحة المشروع نفسها.
   * - مادة تملك id: رابط عميق ثابت لبطاقتها بالذات (#material-<id>)،
   *   الذي يفتح القسم المضيف تلقائيًا وينتقل إلى البطاقة ويبرزها.
   * - قسم، أو مادة بلا id: نفس الرابط العميق للقسم (Hash مبني من
   *   slugifySectionName كما هو مستخدم أصلاً في زر "مشاركة القسم").
   * - غير ذلك: رابط صفحة المشروع فقط.
   */
  function siteSearchResultHref(entry) {
    if (!entry.projectSlug) return null;
    var base = "projects/" + entry.projectSlug + ".html";
    if (entry.type === "project") return base;

    if (entry.type === "material" && entry.materialId) {
      return base + "#material-" + entry.materialId;
    }

    var sectionName = entry.type === "section" ? entry.title : entry.sectionName;
    if (sectionName) {
      return base + "#section-" + slugifySectionName(sectionName);
    }
    return base;
  }

  /**
   * يبني عقد DOM آمنة (نصوص عادية + عناصر <mark>) تُبرز كل تكرار لنص
   * البحث داخل "text"، دون استخدام innerHTML مطلقًا على أي نص مصدره
   * البيانات، حتى لا يمكن لأي محتوى في data/materials.js أن يُفسَّر
   * كـ HTML عرضي.
   */
  function highlightSearchMatch(text, query) {
    var frag = document.createDocumentFragment();
    var value = String(text || "");
    if (!value) return frag;

    var lowerValue = value.toLowerCase();
    var lowerQuery = normalizeSearchText(query);
    if (!lowerQuery) {
      frag.appendChild(document.createTextNode(value));
      return frag;
    }

    var cursor = 0;
    var pos = lowerValue.indexOf(lowerQuery, cursor);
    if (pos === -1) {
      frag.appendChild(document.createTextNode(value));
      return frag;
    }

    while (pos !== -1) {
      if (pos > cursor) {
        frag.appendChild(document.createTextNode(value.slice(cursor, pos)));
      }
      frag.appendChild(
        el("mark", { class: "search-match" }, value.slice(pos, pos + lowerQuery.length))
      );
      cursor = pos + lowerQuery.length;
      pos = lowerValue.indexOf(lowerQuery, cursor);
    }
    if (cursor < value.length) {
      frag.appendChild(document.createTextNode(value.slice(cursor)));
    }
    return frag;
  }

  /** يقتطع نصًا طويلاً لعرضه كجزء مختصر من الوصف داخل نتيجة بحث واحدة. */
  function truncateForSearchResult(text, maxLength) {
    var value = String(text || "").trim();
    if (value.length <= maxLength) return value;
    return value.slice(0, maxLength).trim() + "…";
  }

  /**
   * تهيئة صندوق البحث الفوري في الصفحة الرئيسية فقط. لا تُنفَّذ أي
   * خطوة إذا لم توجد عناصره في الصفحة الحالية (صفحات المشاريع مثلاً)،
   * حتى لا تتأثر أي صفحة أخرى بهذه الميزة في هذه المرحلة.
   */
  function initSiteSearch() {
    var input = document.getElementById("site-search-input");
    var resultsBox = document.getElementById("site-search-results");
    var wrap = document.getElementById("site-search");
    if (!input || !resultsBox || !wrap) return;

    var currentQuery = "";
    var currentResults = [];
    var visibleCount = SEARCH_MAX_RESULTS;
    var activeIndex = -1;
    var debounceTimer = null;

    function optionId(index) {
      return "site-search-option-" + index;
    }

    function closeResults() {
      resultsBox.hidden = true;
      resultsBox.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      activeIndex = -1;
    }

    function setActive(index) {
      var options = resultsBox.querySelectorAll("[data-result-index]");
      options.forEach(function (opt) {
        opt.classList.remove("is-active");
        opt.setAttribute("aria-selected", "false");
      });
      activeIndex = index;
      if (index >= 0 && options[index]) {
        options[index].classList.add("is-active");
        options[index].setAttribute("aria-selected", "true");
        input.setAttribute("aria-activedescendant", optionId(index));
        if (typeof options[index].scrollIntoView === "function") {
          options[index].scrollIntoView({ block: "nearest" });
        }
      } else {
        input.removeAttribute("aria-activedescendant");
      }
    }

    function selectResult(index) {
      var visible = currentResults.slice(0, visibleCount);
      var picked = visible[index];
      if (!picked) return;
      var href = siteSearchResultHref(picked.entry);
      if (href) {
        window.location.href = href;
      }
    }

    function renderResults() {
      resultsBox.innerHTML = "";

      if (currentResults.length === 0) {
        resultsBox.appendChild(el("p", { class: "search-empty" }, "لا توجد نتائج مطابقة"));
        resultsBox.hidden = false;
        input.setAttribute("aria-expanded", "true");
        activeIndex = -1;
        input.removeAttribute("aria-activedescendant");
        return;
      }

      var visible = currentResults.slice(0, visibleCount);

      visible.forEach(function (result, index) {
        var entry = result.entry;
        var option = el("div", {
          class: "search-result",
          role: "option",
          id: optionId(index),
          "data-result-index": String(index),
          "aria-selected": "false",
        });

        var titleLine = el("div", { class: "search-result-title" });
        titleLine.appendChild(highlightSearchMatch(entry.title, currentQuery));
        option.appendChild(titleLine);

        var metaLine = el("div", { class: "search-result-meta" });
        metaLine.appendChild(
          el("span", { class: "search-result-type" }, siteSearchTypeLabel(entry.type))
        );
        if (entry.projectName) {
          metaLine.appendChild(el("span", null, "المشروع: " + entry.projectName));
        }
        if (entry.sectionName) {
          metaLine.appendChild(el("span", null, "القسم: " + entry.sectionName));
        }
        option.appendChild(metaLine);

        if (entry.description) {
          var descLine = el("p", { class: "search-result-desc" });
          descLine.appendChild(
            highlightSearchMatch(truncateForSearchResult(entry.description, 140), currentQuery)
          );
          option.appendChild(descLine);
        }

        // mousedown بدل click: حتى لا يُغلق الاختيار قبل تنفيذه بفعل
        // blur حقل الإدخال الذي قد يسبق حدث click في بعض المتصفحات.
        option.addEventListener("mousedown", function (evt) {
          evt.preventDefault();
          selectResult(index);
        });
        option.addEventListener("mouseenter", function () {
          setActive(index);
        });

        resultsBox.appendChild(option);
      });

      if (currentResults.length > visibleCount) {
        var showAllBtn = el(
          "button",
          { type: "button", class: "search-show-all" },
          "عرض كل النتائج"
        );
        showAllBtn.addEventListener("mousedown", function (evt) {
          evt.preventDefault();
          visibleCount = currentResults.length;
          renderResults();
        });
        resultsBox.appendChild(showAllBtn);
      }

      resultsBox.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    function performSearch(value) {
      currentQuery = normalizeSearchText(value).trim();
      visibleCount = SEARCH_MAX_RESULTS;

      if (currentQuery.length < SEARCH_MIN_CHARS) {
        closeResults();
        return;
      }

      currentResults = runSiteSearch(value);
      renderResults();
    }

    input.addEventListener("input", function () {
      if (debounceTimer) clearTimeout(debounceTimer);
      var value = input.value;
      debounceTimer = setTimeout(function () {
        performSearch(value);
      }, SEARCH_DEBOUNCE_MS);
    });

    input.addEventListener("keydown", function (evt) {
      var visible = currentResults.slice(0, visibleCount);

      if (evt.key === "ArrowDown") {
        if (resultsBox.hidden || visible.length === 0) return;
        evt.preventDefault();
        setActive(activeIndex < visible.length - 1 ? activeIndex + 1 : 0);
      } else if (evt.key === "ArrowUp") {
        if (resultsBox.hidden || visible.length === 0) return;
        evt.preventDefault();
        setActive(activeIndex > 0 ? activeIndex - 1 : visible.length - 1);
      } else if (evt.key === "Enter") {
        if (resultsBox.hidden || visible.length === 0) return;
        evt.preventDefault();
        selectResult(activeIndex >= 0 ? activeIndex : 0);
      } else if (evt.key === "Escape") {
        if (!resultsBox.hidden) {
          evt.preventDefault();
          closeResults();
        }
      }
    });

    document.addEventListener("click", function (evt) {
      if (!wrap.contains(evt.target)) {
        closeResults();
      }
    });
  }

  /** تعيين السنة الحالية ديناميكيًا في كل عنصر يحمل الصنف current-year،
   * بدل كتابة سنة ثابتة يدويًا في التذييل. */
  function setCurrentYear() {
    const yearNodes = document.querySelectorAll(".current-year");
    if (!yearNodes.length) return;
    const year = String(new Date().getFullYear());
    yearNodes.forEach(function (node) {
      node.textContent = year;
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    setCurrentYear();

    const statsCard = document.getElementById("library-stats");
    if (statsCard) {
      renderLibraryStats(statsCard);
    }

    const recentUpdates = document.getElementById("recent-updates");
    if (recentUpdates) {
      renderRecentUpdates(recentUpdates);
    }

    const showcase = document.getElementById("featured-projects");
    if (showcase) {
      renderProjectShowcase(showcase);
    }

    const materialList = document.getElementById("material-list");
    if (materialList) {
      const slug = materialList.getAttribute("data-project-slug");
      renderMaterialList(materialList, slug);
      addProjectShareButton(slug);
    }

    initSiteSearch();
  });
})();
