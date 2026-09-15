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

  /** بناء قائمة المواد الخاصة بمشروع محدد */
  function renderMaterialList(container, projectSlug) {
    if (!container || typeof MATERIALS === "undefined") return;

    const items = MATERIALS.filter(function (m) {
      return m.project === projectSlug;
    });

    if (items.length === 0) {
      const empty = el(
        "p",
        { class: "empty-state" },
        "لا توجد مواد متاحة حاليًا ضمن هذا المشروع."
      );
      container.appendChild(empty);
      return;
    }

    // المواد التي لا تملك حقل "section" تُعرض بالطريقة القديمة المسطّحة
    // (بلا أي عنوان قسم)، حفاظًا على التوافق مع أي بيانات قديمة لا تستخدم
    // هذا الحقل. المواد التي تملك "section" تُجمع تحت عنوان قسمها، بترتيب
    // ظهور كل قسم لأول مرة داخل مصفوفة MATERIALS.
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

    sectionOrder.forEach(function (sectionName) {
      const sectionWrap = el("div", { class: "material-section" });
      sectionWrap.appendChild(el("h2", { class: "section-heading" }, sectionName));

      // تجميع ثابت (غير تفاعلي) حسب "track" داخل القسم، بترتيب ظهور كل
      // مسار لأول مرة في مصفوفة المواد. المواد التي لا تملك track (مثل
      // مواد القسم الأول) تُعرض مباشرة بلا عنوان مسار.
      const trackOrder = [];
      const trackGroups = {};
      const noTrackItems = [];

      sectionGroups[sectionName].forEach(function (item) {
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

      noTrackItems.forEach(function (item) {
        sectionWrap.appendChild(buildMaterialCard(item));
      });

      trackOrder.forEach(function (trackName) {
        const trackWrap = el("div", { class: "material-track" });
        trackWrap.appendChild(el("h3", { class: "track-heading" }, trackName));
        trackGroups[trackName].forEach(function (item) {
          trackWrap.appendChild(buildMaterialCard(item));
        });
        sectionWrap.appendChild(trackWrap);
      });

      container.appendChild(sectionWrap);
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
