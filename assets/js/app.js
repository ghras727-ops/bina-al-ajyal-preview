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

  /** بناء بطاقة عرض للمشروع في الصفحة الرئيسية */
  function renderProjectShowcase(container) {
    if (!container || typeof PROJECTS === "undefined") return;

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
    const card = el("article", { class: cardClass });
    card.appendChild(el("h3", null, item.title));

    if (item.description) {
      card.appendChild(el("p", null, item.description));
    }

    const meta = el("div", { class: "material-meta" });
    meta.appendChild(el("span", null, "النوع: " + item.fileType));
    if (item.fileSize) {
      meta.appendChild(el("span", null, "الحجم: " + item.fileSize));
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
  function buildAccordionItem(descriptor, index, projectSlug) {
    const buttonId = "accordion-trigger-" + projectSlug + "-" + index;
    const panelId = "accordion-panel-" + projectSlug + "-" + index;

    const item = el("div", { class: "accordion-item" });

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

    sectionDescriptors.forEach(function (descriptor, index) {
      const built = buildAccordionItem(descriptor, index, projectSlug);
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
  }

  /** بناء قائمة المواد الخاصة بمشروع محدد، مع عرض أقسامها كـ Accordion. */
  function renderMaterialList(container, projectSlug) {
    if (!container || typeof MATERIALS === "undefined") return;

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

    renderAccordion(container, sectionDescriptors, projectSlug);
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

    const showcase = document.getElementById("featured-projects");
    if (showcase) {
      renderProjectShowcase(showcase);
    }

    const materialList = document.getElementById("material-list");
    if (materialList) {
      const slug = materialList.getAttribute("data-project-slug");
      renderMaterialList(materialList, slug);
    }
  });
})();
