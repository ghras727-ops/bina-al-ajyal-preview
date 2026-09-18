/**
 * admin.js — منطق لوحة الإدارة المحلية.
 * لا يستخدم أي مكتبة خارجية، ولا يكتب أي بيانات مباشرة إلى innerHTML
 * لأي نص قادم من المستخدم (استخدام textContent حصريًا لذلك).
 * لا يحفظ أي شيء فعليًا على القرص إلا عبر POST /admin/api/save
 * بعد تأكيد صريح من المستخدم.
 */

(function () {
  "use strict";

  // -------------------------------------------------------------
  // ثوابت
  // -------------------------------------------------------------

  const ENDPOINTS = {
    materials: "/admin/api/materials",
    validateUrl: "/admin/api/validate-url",
    save: "/admin/api/save",
    projects: "/admin/api/projects",
    projectsUpdate: "/admin/api/projects/update",
    projectsDelete: "/admin/api/projects/delete",
    sectionsUpdate: "/admin/api/sections/update",
    sectionsDelete: "/admin/api/sections/delete",
  };

  const CONFIRM_TOKEN = "LOCAL_ADMIN_SAVE_TEST";

  const ARCHIVE_PREFIX = "https://archive.org/download/";
  const FORBIDDEN_SUBSTRINGS = ["/details/", "/search.php", "ca.archive.org", "us.archive.org"];
  const ARCHIVE_PATH_RE = /^[A-Za-z0-9._-]+\/[^/]+$/;
  const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  // -------------------------------------------------------------
  // الحالة المحلية (working state) — لا تُحفظ فعليًا إلا عند الاعتماد
  // -------------------------------------------------------------

  const state = {
    projects: [],
    materials: [],
    sections: [],
  };

  let dirty = false;
  let currentProjectSlug = null;
  let pendingDetailFocus = null;

  // العنصر الذي كان يحمل التركيز قبل فتح آخر نافذة منبثقة، لإعادة
  // التركيز إليه تلقائيًا عند الإغلاق (بالإغلاق بالزر أو Escape أو
  // النقر خارج النافذة).
  let lastFocusedBeforeModal = null;

  // -------------------------------------------------------------
  // أدوات DOM مساعدة (آمنة من XSS — بلا أي innerHTML لنص المستخدم)
  // -------------------------------------------------------------

  function $(id) {
    return document.getElementById(id);
  }

  // ربط حدث بأمان: إن لم يوجد العنصر في الصفحة (مثلاً بعد تعديل لاحق على
  // admin/index.html)، يُسجَّل تحذير في console فقط، ولا يُوقَف تنفيذ بقية
  // الدالة المستدعية — غياب عنصر واحد لا يجب أن يعطّل اللوحة كاملة.
  function on(id, event, handler) {
    const el = $(id);
    if (!el) {
      console.warn("[admin] عنصر مفقود من admin/index.html، تم تجاوز ربط الحدث: #" + id);
      return;
    }
    el.addEventListener(event, handler);
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function createEmptyState(text) {
    const d = document.createElement("div");
    d.className = "empty-state";
    d.textContent = text;
    return d;
  }

  function containsHtml(str) {
    if (!str) return false;
    return /[<>]/.test(str) || /javascript:/i.test(str);
  }

  function setFieldError(id, message) {
    const node = $(id);
    if (node) node.textContent = message || "";
    // معرّف الحقل نفسه هو معرّف رسالة الخطأ بعد حذف لاحقة "Error"
    // (مثال: projectNameError ← projectName)، حسب الاتفاق المستخدم في
    // admin/index.html. نستخدم هذا لتحديث aria-invalid تلقائيًا دون
    // الحاجة لتعديل كل نقطة استدعاء لهذه الدالة في الملف.
    const fieldId = id.replace(/Error$/, "");
    const field = $(fieldId);
    if (field) {
      if (message) {
        field.setAttribute("aria-invalid", "true");
      } else {
        field.removeAttribute("aria-invalid");
      }
    }
  }

  function clearFieldError(id) {
    setFieldError(id, "");
  }

  function byOrderThenText(field) {
    return function (a, b) {
      const ao = typeof a.order === "number" ? a.order : 9999;
      const bo = typeof b.order === "number" ? b.order : 9999;
      if (ao !== bo) return ao - bo;
      return (a[field] || "").localeCompare(b[field] || "", "ar");
    };
  }

  const byProjectOrder = byOrderThenText("name");
  const bySectionOrder = byOrderThenText("name");
  const byMaterialOrder = byOrderThenText("title");

  // -------------------------------------------------------------
  // إشعارات
  // -------------------------------------------------------------

  function notify(type, message) {
    const container = $("notifications");
    const div = document.createElement("div");
    div.className = "notification notification-" + (type === "error" ? "error" : "success");
    // حاوية #notifications تحمل بالفعل aria-live="polite"، وهذا يكفي
    // لإعلان رسائل النجاح. رسائل الخطأ تحصل إضافيًا على role="alert"
    // لتنبيه أكثر إلحاحًا (منطقة حيّة عاجلة مستقلة) دون تغيير أي سلوك
    // بصري أو منطقي آخر.
    if (type === "error") {
      div.setAttribute("role", "alert");
    }
    div.textContent = message;
    container.appendChild(div);
    const timeout = type === "error" ? 8000 : 5000;
    setTimeout(function () {
      if (div.parentNode) div.parentNode.removeChild(div);
    }, timeout);
  }

  // -------------------------------------------------------------
  // التحقق المحلي (المرآة) من رابط Internet Archive
  // -------------------------------------------------------------

  function localValidateArchiveUrl(url) {
    if (!url || typeof url !== "string" || url.trim() === "") {
      return { valid: false, empty: true, reason: "الرابط فارغ." };
    }
    const trimmed = url.trim();
    for (let i = 0; i < FORBIDDEN_SUBSTRINGS.length; i++) {
      const bad = FORBIDDEN_SUBSTRINGS[i];
      if (trimmed.indexOf(bad) !== -1) {
        return { valid: false, empty: false, reason: "الرابط يحتوي على جزء ممنوع: " + bad };
      }
    }
    if (trimmed.indexOf(ARCHIVE_PREFIX) !== 0) {
      return { valid: false, empty: false, reason: "الرابط لا يبدأ بـ " + ARCHIVE_PREFIX };
    }
    const remainder = trimmed.slice(ARCHIVE_PREFIX.length);
    if (!ARCHIVE_PATH_RE.test(remainder)) {
      return {
        valid: false,
        empty: false,
        reason: "الرابط يجب أن يكون بالصيغة https://archive.org/download/<identifier>/<filename> بالضبط.",
      };
    }
    return { valid: true, empty: false, reason: "رابط صالح شكليًا." };
  }

  // -------------------------------------------------------------
  // تحميل البيانات من الخادم
  // -------------------------------------------------------------

  function deriveSections(materials, explicitSections) {
    const map = new Map();
    let autoOrder = 0;

    (explicitSections || []).forEach(function (s) {
      if (!s || !s.project || !s.name) return;
      const key = s.project + "|||" + s.name;
      map.set(key, {
        project: s.project,
        name: s.name,
        description: s.description || "",
        order: typeof s.order === "number" ? s.order : autoOrder++,
      });
    });

    materials.forEach(function (m) {
      if (!m.project || !m.section) return;
      const key = m.project + "|||" + m.section;
      if (!map.has(key)) {
        map.set(key, { project: m.project, name: m.section, order: autoOrder++ });
      }
    });

    return Array.from(map.values());
  }

  const LOAD_TIMEOUT_MS = 10000;

  async function loadData() {
    showLoading();

    const controller = new AbortController();
    const timeoutId = setTimeout(function () {
      controller.abort();
    }, LOAD_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(ENDPOINTS.materials, { method: "GET", signal: controller.signal });
    } catch (err) {
      clearTimeout(timeoutId);
      const timedOut = err && err.name === "AbortError";
      const reason = timedOut
        ? "انتهت مهلة الاتصال (" + (LOAD_TIMEOUT_MS / 1000) + " ثوانٍ) دون رد من الخادم."
        : "تعذّر الوصول إلى الخادم (قد يكون غير مُشغَّل، أو منفذ 8765 محجوب).";
      showConnectionError({
        endpoint: ENDPOINTS.materials,
        status: null,
        reason: reason,
      });
      return;
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      showConnectionError({
        endpoint: ENDPOINTS.materials,
        status: res.status,
        reason: "رد الخادم بحالة HTTP غير ناجحة.",
      });
      return;
    }

    let data;
    try {
      data = await res.json();
    } catch (err) {
      showConnectionError({
        endpoint: ENDPOINTS.materials,
        status: res.status,
        reason: "رد الخادم بمحتوى ليس JSON صالحًا.",
      });
      return;
    }

    if (!data.ok) {
      showConnectionError({
        endpoint: ENDPOINTS.materials,
        status: res.status,
        reason: data.error || "خطأ غير معروف من الخادم.",
      });
      return;
    }

    try {
      state.projects = (data.projects || []).map(function (p) {
        return Object.assign({}, p);
      });
      state.materials = (data.materials || []).map(function (m) {
        return Object.assign({}, m);
      });
      state.sections = deriveSections(state.materials, data.sections || []);
      dirty = false;
      currentProjectSlug = null;
      hideLoading();
      showListView();
      updateSaveBar();
    } catch (err) {
      console.error("[admin] خطأ أثناء معالجة/عرض بيانات المشاريع:", err);
      showConnectionError({
        endpoint: ENDPOINTS.materials,
        status: res.status,
        reason: "تم استلام البيانات لكن تعذّر عرضها (خطأ داخلي: " + (err && err.message ? err.message : String(err)) + ").",
      });
    }
  }

  // -------------------------------------------------------------
  // إدارة الشاشات (views)
  // -------------------------------------------------------------

  function showLoading() {
    $("loadingState").hidden = false;
    $("connectionErrorState").hidden = true;
    $("globalSearchPanel").hidden = true;
    $("view-list").hidden = true;
    $("view-project").hidden = true;
    $("saveBar").hidden = true;
  }

  function hideLoading() {
    $("loadingState").hidden = true;
    $("globalSearchPanel").hidden = false;
  }

  function showConnectionError(info) {
    $("loadingState").hidden = true;
    $("connectionErrorState").hidden = false;
    $("globalSearchPanel").hidden = true;
    $("view-list").hidden = true;
    $("view-project").hidden = true;
    $("saveBar").hidden = true;

    const detailNode = $("connectionErrorDetail");
    if (detailNode) {
      if (info) {
        const parts = [];
        if (info.endpoint) parts.push("المسار: " + info.endpoint);
        if (info.status !== null && info.status !== undefined) parts.push("HTTP " + info.status);
        if (info.reason) parts.push(info.reason);
        detailNode.textContent = parts.join(" — ");
      } else {
        detailNode.textContent = "";
      }
    }
  }

  function showView(id) {
    ["view-list", "view-project"].forEach(function (v) {
      $(v).hidden = v !== id;
    });
  }

  function showListView() {
    renderProjectList();
    showView("view-list");
  }

  function openProjectDetail(slug) {
    currentProjectSlug = slug;
    renderProjectDetail();
    showView("view-project");
    // يجب تمرير الصفحة بعد إظهار شاشة المشروع؛ قبل ذلك يكون الهدف مخفيًا
    // ولا يستطيع المتصفح حساب موضعه أو تمرير الصفحة إليه بشكل صحيح.
    focusPendingDetail();
  }

  // -------------------------------------------------------------
  // عرض قائمة المشاريع
  // -------------------------------------------------------------

  function renderProjectList() {
    const grid = $("projectsGrid");
    clearNode(grid);

    if (state.projects.length === 0) {
      grid.appendChild(createEmptyState("لا توجد مشاريع بعد. استخدم زر «+ إضافة مشروع» لإضافة أول مشروع."));
      return;
    }

    state.projects
      .slice()
      .sort(byProjectOrder)
      .forEach(function (p) {
        grid.appendChild(buildProjectCard(p));
      });
  }

  function buildProjectCard(p) {
    const card = document.createElement("div");
    card.className = "project-card";

    const h3 = document.createElement("h3");
    h3.textContent = p.name || "(بدون اسم)";
    card.appendChild(h3);

    const desc = document.createElement("p");
    desc.textContent = p.description || "";
    card.appendChild(desc);

    const meta = document.createElement("div");
    meta.className = "project-card-meta";

    const count = state.materials.filter(function (m) {
      return m.project === p.slug;
    }).length;

    const badge = document.createElement("span");
    badge.className = "project-card-badge";
    badge.textContent = count + " مادة";
    meta.appendChild(badge);

    if (p.__draft) {
      const draftBadge = document.createElement("span");
      draftBadge.className = "project-card-draft-badge";
      draftBadge.textContent = "مسودة غير محفوظة";
      meta.appendChild(draftBadge);
    }

    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "project-card-actions";

    const manageBtn = document.createElement("button");
    manageBtn.type = "button";
    manageBtn.className = "btn btn-secondary";
    manageBtn.textContent = "إدارة المشروع";
    manageBtn.addEventListener("click", function () {
      openProjectDetail(p.slug);
    });
    actions.appendChild(manageBtn);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-secondary";
    editBtn.textContent = "تعديل المشروع";
    editBtn.addEventListener("click", function () {
      openEditProjectModal(p.slug);
    });
    actions.appendChild(editBtn);

    const addSectionBtn = document.createElement("button");
    addSectionBtn.type = "button";
    addSectionBtn.className = "btn btn-ghost";
    addSectionBtn.textContent = "إضافة قسم";
    addSectionBtn.addEventListener("click", function () {
      resetAddSectionForm();
      populateProjectSelect($("sectionProject"), p.slug);
      openModal("modal-add-section");
    });
    actions.appendChild(addSectionBtn);

    const addMaterialBtn = document.createElement("button");
    addMaterialBtn.type = "button";
    addMaterialBtn.className = "btn btn-ghost";
    addMaterialBtn.textContent = "إضافة مادة";
    addMaterialBtn.addEventListener("click", function () {
      resetAddMaterialForm();
      populateProjectSelect($("materialProject"), p.slug);
      populateSectionSelect($("materialSection"), p.slug);
      updateMaterialPreview();
      openModal("modal-add-material");
    });
    actions.appendChild(addMaterialBtn);

    const deleteProjectBtn = document.createElement("button");
    deleteProjectBtn.type = "button";
    deleteProjectBtn.className = "btn btn-danger-outline";
    deleteProjectBtn.textContent = "حذف المشروع";
    deleteProjectBtn.addEventListener("click", function () {
      openDeleteProjectModal(p.slug);
    });
    actions.appendChild(deleteProjectBtn);

    card.appendChild(actions);

    return card;
  }

  // -------------------------------------------------------------
  // البحث السريع داخل لوحة الإدارة
  // -------------------------------------------------------------

  function normalizeSearchValue(value) {
    return String(value === null || value === undefined ? "" : value)
      .trim()
      .toLocaleLowerCase("ar");
  }

  function projectBySlug(slug) {
    return state.projects.find(function (p) {
      return p.slug === slug;
    });
  }

  function sectionByProjectAndName(project, name) {
    return state.sections.find(function (s) {
      return s.project === project && s.name === name;
    });
  }

  function projectDisplayName(slug) {
    const project = projectBySlug(slug);
    return project ? project.name || project.slug : slug || "غير معروف";
  }

  function searchProjects(query) {
    const needle = normalizeSearchValue(query);
    if (!needle) return [];
    return state.projects
      .filter(function (p) {
        return [p.name, p.description, p.slug, p.id].some(function (value) {
          return normalizeSearchValue(value).indexOf(needle) !== -1;
        });
      })
      .sort(byProjectOrder)
      .map(function (p) {
        return { kind: "project", name: p.name || p.slug, project: p };
      });
  }

  function searchSections(query) {
    const needle = normalizeSearchValue(query);
    if (!needle) return [];
    return state.sections
      .filter(function (s) {
        return [s.name, s.description, s.project, s.slug].some(function (value) {
          return normalizeSearchValue(value).indexOf(needle) !== -1;
        });
      })
      .sort(bySectionOrder)
      .map(function (s) {
        return {
          kind: "section",
          name: s.name,
          section: s,
          project: projectBySlug(s.project),
        };
      });
  }

  function searchMaterials(query) {
    const needle = normalizeSearchValue(query);
    if (!needle) return [];
    return state.materials
      .filter(function (m) {
        return [m.title, m.description, m.track, m.id, m.slug, m.project, m.section].some(function (value) {
          return normalizeSearchValue(value).indexOf(needle) !== -1;
        });
      })
      .sort(byMaterialOrder)
      .map(function (m) {
        return {
          kind: "material",
          name: m.title || m.id,
          material: m,
          project: projectBySlug(m.project),
          section: sectionByProjectAndName(m.project, m.section),
        };
      });
  }

  function searchAll(query) {
    return searchProjects(query).concat(searchSections(query), searchMaterials(query));
  }

  function appendHighlightedText(container, value, query) {
    const text = String(value === null || value === undefined ? "" : value);
    const needle = normalizeSearchValue(query);
    if (!needle) {
      container.textContent = text;
      return;
    }

    const comparable = text.toLocaleLowerCase("ar");
    let cursor = 0;
    let matchIndex = comparable.indexOf(needle, cursor);

    while (matchIndex !== -1) {
      if (matchIndex > cursor) {
        container.appendChild(document.createTextNode(text.slice(cursor, matchIndex)));
      }
      const mark = document.createElement("mark");
      mark.className = "search-highlight";
      mark.textContent = text.slice(matchIndex, matchIndex + needle.length);
      container.appendChild(mark);
      cursor = matchIndex + needle.length;
      matchIndex = comparable.indexOf(needle, cursor);
    }

    if (cursor < text.length) {
      container.appendChild(document.createTextNode(text.slice(cursor)));
    }
  }

  function renderSearchResults(container, results, onSelect, query) {
    clearNode(container);
    if (!results.length) {
      const empty = document.createElement("p");
      empty.className = "search-empty";
      empty.textContent = "لا توجد نتائج مطابقة.";
      container.appendChild(empty);
      container.hidden = false;
      return;
    }

    results.forEach(function (result) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result-item";
      button.setAttribute("role", "option");

      const name = document.createElement("span");
      name.className = "search-result-name";
      appendHighlightedText(name, result.name, query);
      button.appendChild(name);

      const meta = document.createElement("span");
      meta.className = "search-result-meta";
      const type =
        result.kind === "project" ? "مشروع" :
        result.kind === "section" ? "قسم" : "مادة";
      const projectSlug = result.kind === "project"
        ? result.project.slug
        : result.kind === "section"
          ? result.section.project
          : result.material.project;
      const projectName = result.kind === "project"
        ? result.project.slug
        : projectDisplayName(projectSlug);
      const sectionName =
        result.kind === "material" && result.material.section
          ? result.material.section
          : "";
      meta.textContent = "";
      const typeSpan = document.createElement("span");
      typeSpan.className = "search-result-type";
      typeSpan.textContent = type;
      meta.appendChild(typeSpan);
      meta.appendChild(document.createTextNode(" — المشروع: "));
      const projectNameSpan = document.createElement("span");
      appendHighlightedText(projectNameSpan, projectName, query);
      meta.appendChild(projectNameSpan);
      if (sectionName) {
        meta.appendChild(document.createTextNode(" — القسم: "));
        const sectionNameSpan = document.createElement("span");
        appendHighlightedText(sectionNameSpan, result.material.section, query);
        meta.appendChild(sectionNameSpan);
      }
      button.appendChild(meta);

      button.addEventListener("click", function () {
        onSelect(result);
      });
      container.appendChild(button);
    });
    container.hidden = false;
  }

  function focusPendingDetail() {
    if (!pendingDetailFocus) return;
    const focus = pendingDetailFocus;
    pendingDetailFocus = null;

    const selector = focus.kind === "section" ? "section" : "material";
    const nodes = document.querySelectorAll(
      focus.kind === "section" ? ".section-block" : ".material-card"
    );
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (
        (selector === "section" && node.dataset.section === focus.name) ||
        (selector === "material" && node.dataset.materialId === focus.id)
      ) {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
        node.classList.remove("search-focus");
        void node.offsetWidth;
        node.classList.add("search-focus");
        setTimeout(function () {
          node.classList.remove("search-focus");
        }, 3600);
        break;
      }
    }
  }

  function selectGlobalSearchResult(result) {
    $("globalSearchInput").value = "";
    $("globalSearchResults").hidden = true;
    clearNode($("globalSearchResults"));

    if (result.kind === "project") {
      openProjectDetail(result.project.slug);
      return;
    }

    if (result.kind === "section") {
      pendingDetailFocus = { kind: "section", name: result.section.name };
      openProjectDetail(result.section.project);
      return;
    }

    pendingDetailFocus = { kind: "material", id: result.material.id };
    openProjectDetail(result.material.project);
  }

  // -------------------------------------------------------------
  // عرض تفاصيل مشروع واحد
  // -------------------------------------------------------------

  function renderProjectDetail() {
    const p = state.projects.find(function (x) {
      return x.slug === currentProjectSlug;
    });
    if (!p) {
      showListView();
      return;
    }

    $("projectDetailName").textContent = p.name || "(بدون اسم)";
    $("projectDetailDescription").textContent = p.description || "";

    const container = $("sectionsContainer");
    clearNode(container);

    const sections = state.sections
      .filter(function (s) {
        return s.project === currentProjectSlug;
      })
      .sort(bySectionOrder);

    const materialsNoSection = state.materials.filter(function (m) {
      return m.project === currentProjectSlug && !m.section;
    });

    if (sections.length === 0 && materialsNoSection.length === 0) {
      container.appendChild(createEmptyState("لا توجد أقسام أو مواد بعد لهذا المشروع. ابدأ بإضافة قسم."));
      return;
    }

    sections.forEach(function (s) {
      container.appendChild(buildSectionBlock(s));
    });

    if (materialsNoSection.length) {
      container.appendChild(
        buildSectionBlock({ project: currentProjectSlug, name: "(مواد بلا قسم محدد)" }, materialsNoSection)
      );
    }
  }

  function buildSectionBlock(section, overrideMaterials) {
    const block = document.createElement("div");
    block.className = "section-block";
    block.dataset.project = section.project || "";
    block.dataset.section = section.name || "";

    const header = document.createElement("div");
    header.className = "section-block-header";

    const titleWrap = document.createElement("div");
    const h4 = document.createElement("h4");
    h4.textContent = section.name;
    titleWrap.appendChild(h4);
    if (section.description) {
      const descP = document.createElement("p");
      descP.className = "section-materials-count";
      descP.textContent = section.description;
      titleWrap.appendChild(descP);
    }
    header.appendChild(titleWrap);

    const mats =
      overrideMaterials ||
      state.materials.filter(function (m) {
        return m.project === section.project && m.section === section.name;
      });

    const countSpan = document.createElement("span");
    countSpan.className = "section-materials-count";
    countSpan.textContent = mats.length + " مادة";
    header.appendChild(countSpan);

    if (section.__draft) {
      const draftBadge = document.createElement("span");
      draftBadge.className = "draft-badge";
      draftBadge.textContent = "مسودة";
      header.appendChild(draftBadge);
    }

    block.appendChild(header);

    // أزرار إجراءات القسم: لا تُعرض لكتلة "مواد بلا قسم محدد" الافتراضية،
    // فهي ليست قسمًا فعليًا يمكن تعديله عبر endpoint تعديل القسم.
    if (!overrideMaterials) {
      const sectionActions = document.createElement("div");
      sectionActions.className = "section-block-actions";

      const editSectionBtn = document.createElement("button");
      editSectionBtn.type = "button";
      editSectionBtn.className = "btn btn-secondary btn-small";
      editSectionBtn.textContent = "تعديل القسم";
      editSectionBtn.addEventListener("click", function () {
        openEditSectionModal(section.project, section.name);
      });
      sectionActions.appendChild(editSectionBtn);

      const addMaterialToSectionBtn = document.createElement("button");
      addMaterialToSectionBtn.type = "button";
      addMaterialToSectionBtn.className = "btn btn-ghost btn-small";
      addMaterialToSectionBtn.textContent = "إضافة مادة إلى هذا القسم";
      addMaterialToSectionBtn.addEventListener("click", function () {
        resetAddMaterialForm();
        populateProjectSelect($("materialProject"), section.project);
        populateSectionSelect($("materialSection"), section.project, section.name);
        updateMaterialPreview();
        openModal("modal-add-material");
      });
      sectionActions.appendChild(addMaterialToSectionBtn);

      const deleteSectionBtn = document.createElement("button");
      deleteSectionBtn.type = "button";
      deleteSectionBtn.className = "btn btn-danger-outline btn-small";
      deleteSectionBtn.textContent = "حذف القسم";
      deleteSectionBtn.addEventListener("click", function () {
        openDeleteSectionModal(section.project, section.name);
      });
      sectionActions.appendChild(deleteSectionBtn);

      block.appendChild(sectionActions);
    }

    const list = document.createElement("div");
    list.className = "materials-list";

    if (mats.length === 0) {
      const p = document.createElement("p");
      p.className = "section-materials-count";
      p.textContent = "لا توجد مواد في هذا القسم بعد.";
      list.appendChild(p);
    } else {
      mats
        .slice()
        .sort(byMaterialOrder)
        .forEach(function (m) {
          list.appendChild(buildMaterialListItem(m));
        });
    }

    block.appendChild(list);
    return block;
  }

  function buildMaterialListItem(m) {
    const card = document.createElement("div");
    card.className = "material-card";
    card.dataset.materialId = m.id || "";

    const title = document.createElement("p");
    title.className = "material-card-title";
    title.textContent = m.title || "(بدون عنوان)";
    card.appendChild(title);

    if (m.description) {
      const d = document.createElement("p");
      d.className = "material-card-desc";
      d.textContent = m.description;
      card.appendChild(d);
    }

    const meta = document.createElement("div");
    meta.className = "material-card-meta";

    const typeBadge = document.createElement("span");
    typeBadge.className = "type-badge";
    typeBadge.textContent = m.fileType || "";
    meta.appendChild(typeBadge);

    const statusBadge = document.createElement("span");
    statusBadge.className = "status-badge " + (m.status === "available" ? "status-badge-available" : "status-badge-pending");
    statusBadge.textContent = m.status === "available" ? "متاحة" : "قيد التجهيز";
    meta.appendChild(statusBadge);

    if (m.__draft) {
      const draftBadge = document.createElement("span");
      draftBadge.className = "draft-badge";
      draftBadge.textContent = "مسودة";
      meta.appendChild(draftBadge);
    } else if (m.__edited) {
      const editedBadge = document.createElement("span");
      editedBadge.className = "edited-badge";
      editedBadge.textContent = "معدّلة (غير محفوظة)";
      meta.appendChild(editedBadge);
    }

    card.appendChild(meta);

    // أزرار الإجراءات: تُستخدم material id الفعلي عبر إغلاق (closure)،
    // وليس ترتيب البطاقة أو موضعها في DOM.
    const materialId = m.id;
    const actions = document.createElement("div");
    actions.className = "material-card-actions";

    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.className = "btn btn-ghost btn-small";
    viewBtn.textContent = "عرض";
    viewBtn.addEventListener("click", function () {
      openViewMaterialModal(materialId);
    });
    actions.appendChild(viewBtn);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn btn-secondary btn-small";
    editBtn.textContent = "تعديل";
    editBtn.addEventListener("click", function () {
      openEditMaterialModal(materialId);
    });
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-danger-outline btn-small";
    deleteBtn.textContent = "حذف";
    deleteBtn.addEventListener("click", function () {
      openDeleteMaterialModal(materialId);
    });
    actions.appendChild(deleteBtn);

    card.appendChild(actions);
    return card;
  }

  function findMaterialById(id) {
    return state.materials.find(function (m) {
      return m.id === id;
    });
  }

  // -------------------------------------------------------------
  // نافذة: عرض تفاصيل مادة (للقراءة فقط)
  // -------------------------------------------------------------

  function projectNameForSlug(slug) {
    const p = state.projects.find(function (x) {
      return x.slug === slug;
    });
    return p ? p.name || p.slug : slug;
  }

  function addDetailRow(dl, label, value) {
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = value;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }

  function openViewMaterialModal(id) {
    const m = findMaterialById(id);
    if (!m) {
      notify("error", "تعذّر العثور على المادة — ربما حُذفت بالفعل من المسودة المحلية.");
      return;
    }

    const dl = $("viewMaterialDetails");
    clearNode(dl);

    addDetailRow(dl, "العنوان:", m.title || "(بدون عنوان)");
    addDetailRow(dl, "الوصف:", m.description || "(بلا وصف)");
    addDetailRow(dl, "نوع الملف:", m.fileType || "");
    addDetailRow(dl, "الحجم:", m.fileSize || "(غير محدد)");
    addDetailRow(dl, "المشروع:", projectNameForSlug(m.project));
    addDetailRow(dl, "القسم:", m.section || "(بلا قسم)");
    if (m.track) addDetailRow(dl, "المسار (track):", m.track);
    addDetailRow(dl, "الحالة:", m.status === "available" ? "متاحة" : "قيد التجهيز");
    addDetailRow(dl, "المعرف (id):", m.id);

    const linkDt = document.createElement("dt");
    linkDt.textContent = "الرابط:";
    const linkDd = document.createElement("dd");
    if (m.status === "available" && m.downloadUrl) {
      const a = document.createElement("a");
      a.href = m.downloadUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = m.downloadUrl;
      a.className = "material-link";
      linkDd.appendChild(a);
    } else {
      linkDd.textContent = "لا يوجد رابط بعد (المادة قيد التجهيز).";
    }
    dl.appendChild(linkDt);
    dl.appendChild(linkDd);

    $("modalViewMaterialTitle").textContent = "عرض تفاصيل المادة: " + (m.title || m.id);
    openModal("modal-view-material");
  }

  // -------------------------------------------------------------
  // نافذة: إضافة مشروع
  // -------------------------------------------------------------

  function resetAddProjectForm() {
    $("addProjectForm").reset();
    clearFieldError("projectNameError");
    clearFieldError("projectDescriptionError");
    clearFieldError("projectSlugError");
    updateProjectPreview();
  }

  function updateProjectPreview() {
    const name = $("projectName").value.trim();
    const desc = $("projectDescription").value.trim();
    const nameEl = document.querySelector("#projectPreview .preview-project-name");
    const descEl = document.querySelector("#projectPreview .preview-project-desc");

    if (name) {
      nameEl.textContent = name;
      nameEl.removeAttribute("data-empty");
    } else {
      nameEl.textContent = "سيظهر اسم المشروع هنا";
      nameEl.setAttribute("data-empty", "1");
    }

    if (desc) {
      descEl.textContent = desc;
      descEl.removeAttribute("data-empty");
    } else {
      descEl.textContent = "سيظهر وصف المشروع هنا";
      descEl.setAttribute("data-empty", "1");
    }
  }

  async function handleAddProjectSubmit() {
    clearFieldError("projectNameError");
    clearFieldError("projectDescriptionError");
    clearFieldError("projectSlugError");

    const name = $("projectName").value.trim();
    const description = $("projectDescription").value.trim();
    const slugRaw = $("projectSlug").value.trim();
    const orderRaw = $("projectOrder").value.trim();

    let hasError = false;

    if (!name) {
      setFieldError("projectNameError", "اسم المشروع مطلوب.");
      hasError = true;
    } else if (containsHtml(name)) {
      setFieldError("projectNameError", "لا يُسمح بإدخال HTML داخل الاسم.");
      hasError = true;
    }

    if (containsHtml(description)) {
      setFieldError("projectDescriptionError", "لا يُسمح بإدخال HTML داخل الوصف.");
      hasError = true;
    }

    if (!slugRaw) {
      setFieldError("projectSlugError", "slug مطلوب.");
      hasError = true;
    } else if (!SLUG_RE.test(slugRaw)) {
      setFieldError("projectSlugError", "slug يجب أن يحتوي أحرفًا إنجليزية صغيرة وأرقامًا وشرطات فقط، بلا مسافات أو رموز.");
      hasError = true;
    } else if (
      state.projects.some(function (p) {
        return p.slug === slugRaw;
      })
    ) {
      setFieldError("projectSlugError", "هذا الـ slug مستخدم بالفعل — اختر slug مختلفًا.");
      hasError = true;
    }

    let order;
    if (orderRaw !== "") {
      if (!/^-?\d+$/.test(orderRaw)) {
        setFieldError("projectSlugError", "ترتيب المشروع يجب أن يكون رقمًا صحيحًا.");
        hasError = true;
      } else {
        order = parseInt(orderRaw, 10);
      }
    }

    if (hasError) return;

    // إنشاء مشروع جديد فعل فوري يُنشئ صفحة HTML على القرص، ولذلك يُرسل
    // مباشرة إلى الخادم (بخلاف الأقسام والمواد التي تبقى في مسودة محلية
    // حتى الضغط على «اعتماد وحفظ»). لا يُغلق النموذج ولا يُمسح إلا بعد
    // تأكيد صريح من الخادم بنجاح الإنشاء.
    const projectPayload = { slug: slugRaw, name: name, description: description };
    if (typeof order === "number") projectPayload.order = order;

    const btn = $("submitAddProjectBtn");
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "جارٍ إنشاء المشروع…";

    try {
      const res = await fetch(ENDPOINTS.projects, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectPayload, confirm: CONFIRM_TOKEN }),
      });
      const data = await res.json();

      if (data.ok && data.created) {
        closeModal("modal-add-project");
        notify(
          "success",
          "تم إنشاء المشروع وصفحته بنجاح في: " + data.pagePath
        );
        await loadData();
        openProjectDetail(data.slug);
      } else {
        // فشل صريح من الخادم: لا تُغلق النافذة ولا تُمسح الحقول، وأظهر
        // السبب كما أرسله الخادم بالضبط.
        notify("error", "فشل إنشاء المشروع: " + (data.error || "خطأ غير معروف من الخادم."));
      }
    } catch (err) {
      notify(
        "error",
        "تعذّر الاتصال بخادم الإدارة أثناء إنشاء المشروع. لم يُنشأ أي شيء، ولم تُفقد بيانات النموذج."
      );
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // -------------------------------------------------------------
  // نافذة: تعديل مشروع
  // -------------------------------------------------------------

  function buildProjectSummary(slug) {
    const sections = state.sections
      .filter(function (s) {
        return s.project === slug;
      })
      .sort(bySectionOrder);

    const totalMaterials = state.materials.filter(function (m) {
      return m.project === slug;
    }).length;

    const wrap = document.createElement("div");

    const countsP = document.createElement("p");
    countsP.textContent = "عدد الأقسام: " + sections.length + " — إجمالي المواد: " + totalMaterials;
    wrap.appendChild(countsP);

    if (sections.length === 0) {
      const noneP = document.createElement("p");
      noneP.className = "preview-note";
      noneP.textContent = "لا توجد أقسام لهذا المشروع بعد.";
      wrap.appendChild(noneP);
      return wrap;
    }

    const ul = document.createElement("ul");
    ul.className = "modal-summary-list";
    sections.forEach(function (s) {
      const count = state.materials.filter(function (m) {
        return m.project === slug && m.section === s.name;
      }).length;
      const li = document.createElement("li");
      li.textContent = s.name + " — عدد المواد: " + count;
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    return wrap;
  }

  let editProjectCurrentSlug = null;

  function openEditProjectModal(slug) {
    const p = state.projects.find(function (x) {
      return x.slug === slug;
    });
    if (!p) {
      notify("error", "تعذّر العثور على المشروع.");
      return;
    }

    editProjectCurrentSlug = slug;
    clearFieldError("editProjectNameError");
    clearFieldError("editProjectDescriptionError");
    clearFieldError("editProjectOrderError");

    $("editProjectName").value = p.name || "";
    $("editProjectDescription").value = p.description || "";
    $("editProjectSlugDisplay").textContent = p.slug;
    $("editProjectSlug").value = p.slug;
    $("editProjectOrder").value = typeof p.order === "number" ? String(p.order) : "";

    const summaryContainer = $("editProjectSummary");
    clearNode(summaryContainer);
    summaryContainer.appendChild(buildProjectSummary(slug));

    openModal("modal-edit-project");
  }

  async function handleEditProjectSubmit() {
    clearFieldError("editProjectNameError");
    clearFieldError("editProjectDescriptionError");
    clearFieldError("editProjectOrderError");

    const slug = $("editProjectSlug").value;
    const name = $("editProjectName").value.trim();
    const description = $("editProjectDescription").value.trim();
    const orderRaw = $("editProjectOrder").value.trim();

    let hasError = false;

    if (!name) {
      setFieldError("editProjectNameError", "اسم المشروع مطلوب.");
      hasError = true;
    } else if (containsHtml(name)) {
      setFieldError("editProjectNameError", "لا يُسمح بإدخال HTML داخل الاسم.");
      hasError = true;
    }

    if (containsHtml(description)) {
      setFieldError("editProjectDescriptionError", "لا يُسمح بإدخال HTML داخل الوصف.");
      hasError = true;
    }

    let order;
    if (orderRaw !== "") {
      if (!/^-?\d+$/.test(orderRaw)) {
        setFieldError("editProjectOrderError", "ترتيب المشروع يجب أن يكون رقمًا صحيحًا.");
        hasError = true;
      } else {
        order = parseInt(orderRaw, 10);
      }
    }

    if (hasError) return;

    const projectPayload = { slug: slug, name: name, description: description };
    if (typeof order === "number") projectPayload.order = order;

    const btn = $("submitEditProjectBtn");
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "جارٍ الحفظ…";

    // تعديل مشروع فعل فوري يكتب على القرص مباشرة (كإنشاء مشروع جديد)،
    // ولذلك يُرسل مباشرة إلى الخادم بلا مرور بالمسودة المحلية. لا تُغلق
    // النافذة ولا تُمسح الحقول إلا بعد تأكيد صريح من الخادم بنجاح الحفظ
    // الفعلي (ok === true && saved === true).
    try {
      const res = await fetch(ENDPOINTS.projectsUpdate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: projectPayload, confirm: CONFIRM_TOKEN }),
      });
      const data = await res.json();

      if (data.ok === true && data.saved === true) {
        const wasInDetail = currentProjectSlug === slug;
        closeModal("modal-edit-project");
        let msg = "تم حفظ تعديل المشروع فعليًا. عملية: " + data.operation + ". نسخة احتياطية للبيانات: " + (data.backup || "") + ".";
        if (data.pageBackup) msg += " نسخة احتياطية للصفحة: " + data.pageBackup + ".";
        notify("success", msg);
        await loadData();
        if (wasInDetail) openProjectDetail(slug);
      } else {
        notify("error", "فشل حفظ تعديل المشروع: " + (data.error || "خطأ غير معروف من الخادم."));
      }
    } catch (err) {
      notify(
        "error",
        "تعذّر الاتصال بخادم الإدارة أثناء حفظ تعديل المشروع. لم تُفقد بيانات النموذج، يمكنك المحاولة مرة أخرى."
      );
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // -------------------------------------------------------------
  // نافذة: إضافة قسم
  // -------------------------------------------------------------

  function populateProjectSelect(selectEl, selectedSlug) {
    clearNode(selectEl);
    if (!selectedSlug) {
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "اختر مشروعًا";
      selectEl.appendChild(placeholder);
    }
    state.projects.forEach(function (p) {
      const opt = document.createElement("option");
      opt.value = p.slug;
      opt.textContent = (p.name || p.slug) + " (" + p.slug + ")";
      selectEl.appendChild(opt);
    });
    selectEl.value = selectedSlug || "";
  }

  function resetAddSectionForm() {
    $("addSectionForm").reset();
    clearFieldError("sectionNameError");
    clearFieldError("sectionOrderError");
    $("sectionOrder").value = "0";
  }

  function handleAddSectionSubmit() {
    clearFieldError("sectionNameError");
    clearFieldError("sectionOrderError");

    const project = $("sectionProject").value;
    const name = $("sectionName").value.trim();
    const description = $("sectionDescription").value.trim();
    const orderRaw = $("sectionOrder").value.trim();

    let hasError = false;

    if (!project) {
      notify("error", "اختر المشروع التابع له القسم.");
      hasError = true;
    }

    if (!name) {
      setFieldError("sectionNameError", "اسم القسم مطلوب.");
      hasError = true;
    } else if (containsHtml(name)) {
      setFieldError("sectionNameError", "لا يُسمح بإدخال HTML أو JavaScript في اسم القسم.");
      hasError = true;
    } else if (
      state.sections.some(function (s) {
        return s.project === project && s.name === name;
      })
    ) {
      setFieldError("sectionNameError", "يوجد قسم بهذا الاسم بالفعل داخل هذا المشروع.");
      hasError = true;
    }

    if (containsHtml(description)) {
      notify("error", "لا يُسمح بإدخال HTML أو JavaScript في وصف القسم.");
      hasError = true;
    }

    let order = 0;
    if (orderRaw !== "") {
      if (!/^-?\d+$/.test(orderRaw)) {
        setFieldError("sectionOrderError", "الترتيب يجب أن يكون رقمًا صحيحًا.");
        hasError = true;
      } else {
        order = parseInt(orderRaw, 10);
      }
    }

    if (hasError) return;

    const newSection = {
      project: project,
      name: name,
      description: description,
      order: order,
      __draft: true,
    };
    state.sections.push(newSection);
    dirty = true;
    closeModal("modal-add-section");
    notify("success", "أُضيف القسم «" + name + "» إلى المسودة المحلية. لن يُحفظ وصفه فعليًا حتى الضغط على «اعتماد وحفظ».");
    if (currentProjectSlug === project) renderProjectDetail();
    updateSaveBar();
  }

  // -------------------------------------------------------------
  // نافذة: تعديل قسم
  // -------------------------------------------------------------

  function openEditSectionModal(projectSlug, sectionName) {
    const section = state.sections.find(function (s) {
      return s.project === projectSlug && s.name === sectionName;
    });
    if (!section) {
      notify("error", "تعذّر العثور على القسم.");
      return;
    }

    clearFieldError("editSectionNameError");
    clearFieldError("editSectionDescriptionError");
    clearFieldError("editSectionOrderError");

    $("editSectionProject").value = projectSlug;
    $("editSectionOldName").value = sectionName;
    $("editSectionProjectDisplay").textContent = projectNameForSlug(projectSlug) + " (" + projectSlug + ")";
    $("editSectionName").value = section.name || "";
    $("editSectionDescription").value = section.description || "";
    $("editSectionOrder").value = typeof section.order === "number" ? String(section.order) : "";

    const count = state.materials.filter(function (m) {
      return m.project === projectSlug && m.section === sectionName;
    }).length;
    $("editSectionMaterialsCount").textContent = count + " مادة";

    openModal("modal-edit-section");
  }

  async function handleEditSectionSubmit() {
    clearFieldError("editSectionNameError");
    clearFieldError("editSectionDescriptionError");
    clearFieldError("editSectionOrderError");

    const project = $("editSectionProject").value;
    const oldName = $("editSectionOldName").value;
    const name = $("editSectionName").value.trim();
    const description = $("editSectionDescription").value.trim();
    const orderRaw = $("editSectionOrder").value.trim();

    let hasError = false;

    if (!name) {
      setFieldError("editSectionNameError", "اسم القسم مطلوب.");
      hasError = true;
    } else if (containsHtml(name)) {
      setFieldError("editSectionNameError", "لا يُسمح بإدخال HTML أو JavaScript في اسم القسم.");
      hasError = true;
    } else if (
      name !== oldName &&
      state.sections.some(function (s) {
        return s.project === project && s.name === name;
      })
    ) {
      setFieldError("editSectionNameError", "يوجد قسم آخر بهذا الاسم بالفعل ضمن هذا المشروع.");
      hasError = true;
    }

    if (containsHtml(description)) {
      setFieldError("editSectionDescriptionError", "لا يُسمح بإدخال HTML أو JavaScript في وصف القسم.");
      hasError = true;
    }

    let order;
    if (orderRaw !== "") {
      if (!/^-?\d+$/.test(orderRaw)) {
        setFieldError("editSectionOrderError", "الترتيب يجب أن يكون رقمًا صحيحًا.");
        hasError = true;
      } else {
        order = parseInt(orderRaw, 10);
      }
    }

    if (hasError) return;

    const sectionPayload = { project: project, oldName: oldName, name: name, description: description };
    if (typeof order === "number") sectionPayload.order = order;

    const btn = $("submitEditSectionBtn");
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "جارٍ الحفظ…";

    // تعديل قسم فعل فوري يكتب على القرص مباشرة، ولذلك يُرسل مباشرة إلى
    // الخادم. عند الفشل تبقى النافذة والبيانات المُدخلة كما هي دون مسح.
    try {
      const res = await fetch(ENDPOINTS.sectionsUpdate, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: sectionPayload, confirm: CONFIRM_TOKEN }),
      });
      const data = await res.json();

      if (data.ok === true && data.saved === true) {
        const wasInDetail = currentProjectSlug === project;
        closeModal("modal-edit-section");
        notify(
          "success",
          "تم حفظ تعديل القسم فعليًا. عملية: " +
            data.operation +
            ". عدد المواد المحدَّثة: " +
            data.updatedMaterialsCount +
            ". نسخة احتياطية: " +
            (data.backup || "") +
            "."
        );
        await loadData();
        if (wasInDetail) openProjectDetail(project);
      } else {
        notify("error", "فشل حفظ تعديل القسم: " + (data.error || "خطأ غير معروف من الخادم."));
      }
    } catch (err) {
      notify(
        "error",
        "تعذّر الاتصال بخادم الإدارة أثناء حفظ تعديل القسم. لم تُفقد بيانات النموذج، يمكنك المحاولة مرة أخرى."
      );
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // -------------------------------------------------------------
  // نافذة: إضافة مادة
  // -------------------------------------------------------------

  function populateSectionSelect(selectEl, projectSlug, selectedName) {
    clearNode(selectEl);
    if (!projectSlug) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "اختر المشروع أولًا";
      selectEl.appendChild(opt);
      return;
    }
    const secs = state.sections
      .filter(function (s) {
        return s.project === projectSlug;
      })
      .sort(bySectionOrder);

    if (secs.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "لا توجد أقسام لهذا المشروع بعد — أضف قسمًا أولاً";
      selectEl.appendChild(opt);
      return;
    }

    secs.forEach(function (s) {
      const opt = document.createElement("option");
      opt.value = s.name;
      opt.textContent = s.name;
      selectEl.appendChild(opt);
    });
    if (selectedName && secs.some(function (s) { return s.name === selectedName; })) {
      selectEl.value = selectedName;
    } else if (!selectedName) {
      selectEl.selectedIndex = 0;
    }
  }

  function resetAddMaterialForm() {
    $("addMaterialForm").reset();
    populateProjectSelect($("materialProject"));
    populateSectionSelect($("materialSection"), "");
    clearNode($("materialProjectSearchResults"));
    clearNode($("materialSectionSearchResults"));
    $("materialProjectSearchResults").hidden = true;
    $("materialSectionSearchResults").hidden = true;
    clearFieldError("materialTitleError");
    clearFieldError("materialDescriptionError");
    updateUrlStatusDisplay();
    updateComputedStatus();
    updateMaterialPreview();
  }

  function hideSearchResults(inputId, resultsId) {
    const input = $(inputId);
    const results = $(resultsId);
    if (input) input.value = "";
    if (results) {
      clearNode(results);
      results.hidden = true;
    }
  }

  function selectMaterialProject(prefix, projectSlug, sectionName) {
    const projectSelect = $(prefix + "Project");
    const sectionSelect = $(prefix + "Section");
    if (!projectBySlug(projectSlug)) {
      notify("error", "تعذّر اختيار المشروع: المشروع غير موجود في البيانات الحالية.");
      return;
    }

    projectSelect.value = projectSlug;
    populateSectionSelect(sectionSelect, projectSlug, sectionName);
    if (prefix === "material") {
      updateMaterialPreview();
    } else {
      updateEditMaterialPreview();
    }
    if (prefix === "editMaterial") {
      // يبقى العرض في المسودة فقط؛ لا نعدّل المادة الأصلية هنا.
      $("editMaterialProjectSearch").setAttribute("aria-label", "البحث عن مشروع المادة");
    }
    hideSearchResults(prefix === "material" ? "materialProjectSearch" : "editMaterialProjectSearch",
      prefix === "material" ? "materialProjectSearchResults" : "editMaterialProjectSearchResults");
  }

  function selectMaterialSection(prefix, projectSlug, sectionName) {
    if (!sectionByProjectAndName(projectSlug, sectionName)) {
      notify("error", "تعذّر اختيار القسم: القسم لا يتبع المشروع المحدد.");
      return;
    }
    selectMaterialProject(prefix, projectSlug, sectionName);
    $(prefix + "Section").value = sectionName;
    hideSearchResults(prefix === "material" ? "materialSectionSearch" : "editMaterialSectionSearch",
      prefix === "material" ? "materialSectionSearchResults" : "editMaterialSectionSearchResults");
  }

  function wireMaterialSearch(prefix) {
    const projectInputId = prefix + "ProjectSearch";
    const projectResultsId = prefix + "ProjectSearchResults";
    const sectionInputId = prefix + "SectionSearch";
    const sectionResultsId = prefix + "SectionSearchResults";

    on(projectInputId, "input", function () {
      const results = searchProjects($(projectInputId).value).map(function (result) {
        return result;
      });
      const container = $(projectResultsId);
      if (!$(projectInputId).value.trim()) {
        container.hidden = true;
        clearNode(container);
        return;
      }
       renderSearchResults(container, results, function (result) {
        selectMaterialProject(prefix, result.project.slug);
       }, $(projectInputId).value);
    });

    on(sectionInputId, "input", function () {
      const query = $(sectionInputId).value;
      const container = $(sectionResultsId);
      if (!query.trim()) {
        container.hidden = true;
        clearNode(container);
        return;
      }
       renderSearchResults(container, searchSections(query), function (result) {
        selectMaterialSection(prefix, result.section.project, result.section.name);
       }, query);
    });
  }

  function updateUrlStatusDisplay() {
    const url = $("materialDownloadUrl").value;
    const line = $("urlStatusLine");
    const text = $("urlStatusText");
    const result = localValidateArchiveUrl(url);

    line.classList.remove("url-status-valid", "url-status-invalid", "url-status-pending");

    if (result.empty) {
      line.classList.add("url-status-pending");
      text.textContent = "لم يُدخل رابط بعد — ستكون حالة المادة «قيد التجهيز».";
    } else if (result.valid) {
      line.classList.add("url-status-valid");
      text.textContent = "الرابط صالح شكليًا — ستكون حالة المادة «متاحة».";
    } else {
      line.classList.add("url-status-invalid");
      text.textContent = result.reason;
    }
  }

  function updateComputedStatus() {
    const url = $("materialDownloadUrl").value;
    const result = localValidateArchiveUrl(url);
    const statusEl = $("materialComputedStatus");
    statusEl.textContent = result.valid ? "متاحة (available)" : "قيد التجهيز (pending)";
  }

  function updateMaterialPreview() {
    const title = $("materialTitle").value.trim();
    const description = $("materialDescription").value.trim();
    const fileType = $("materialFileType").value;
    const fileSize = $("materialFileSize").value.trim();
    const url = $("materialDownloadUrl").value.trim();
    const result = localValidateArchiveUrl(url);
    const status = result.valid ? "available" : "pending";

    const container = $("materialPreview");
    clearNode(container);

    const h5 = document.createElement("h5");
    h5.textContent = title || "عنوان المادة";
    container.appendChild(h5);

    const p = document.createElement("p");
    p.textContent = description || "وصف المادة سيظهر هنا.";
    container.appendChild(p);

    if (status === "available") {
      const metaP = document.createElement("p");
      metaP.textContent = fileType + (fileSize ? " — " + fileSize : "");
      container.appendChild(metaP);

      const actions = document.createElement("div");
      actions.className = "preview-material-actions";

      const dl = document.createElement("span");
      dl.className = "preview-btn preview-btn-download";
      dl.textContent = "تنزيل (معاينة بصرية فقط)";
      actions.appendChild(dl);

      const rd = document.createElement("span");
      rd.className = "preview-btn preview-btn-read";
      rd.textContent = "قراءة (معاينة بصرية فقط)";
      actions.appendChild(rd);

      container.appendChild(actions);
    } else {
      const note = document.createElement("p");
      note.className = "preview-pending-note";
      note.textContent = "المادة قيد التجهيز وستتوفر قريبًا.";
      container.appendChild(note);
    }
  }

  function slugifyForId(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50);
  }

  function generateMaterialId(project, title) {
    const titleSlug = slugifyForId(title);
    const base = titleSlug ? project + "-" + titleSlug : project + "-material";
    const existingIds = new Set(
      state.materials.map(function (m) {
        return m.id;
      })
    );
    let candidate = base;
    let counter = 2;
    while (existingIds.has(candidate)) {
      candidate = base + "-" + counter;
      counter++;
    }
    return candidate;
  }

  function handleAddMaterialSubmit() {
    clearFieldError("materialTitleError");
    clearFieldError("materialDescriptionError");

    const project = $("materialProject").value;
    const section = $("materialSection").value;
    const title = $("materialTitle").value.trim();
    const description = $("materialDescription").value.trim();
    const fileType = $("materialFileType").value;
    const fileSize = $("materialFileSize").value.trim();
    const track = $("materialTrack").value.trim();
    const orderRaw = $("materialOrder").value.trim();
    const urlRaw = $("materialDownloadUrl").value.trim();

    let hasError = false;

    if (!project) {
      notify("error", "اختر المشروع.");
      hasError = true;
    }
    if (!section) {
      notify("error", "اختر القسم — أضف قسمًا للمشروع أولاً إن لم يوجد أي قسم بعد.");
      hasError = true;
    } else if (!project || !sectionByProjectAndName(project, section)) {
      notify("error", "القسم المحدد لا يتبع المشروع المحدد. اختر المشروع والقسم من البيانات الحالية.");
      hasError = true;
    }
    if (!title) {
      setFieldError("materialTitleError", "عنوان المادة مطلوب.");
      hasError = true;
    } else if (containsHtml(title)) {
      setFieldError("materialTitleError", "لا يُسمح بإدخال HTML أو JavaScript في العنوان.");
      hasError = true;
    }
    if (containsHtml(description)) {
      setFieldError("materialDescriptionError", "لا يُسمح بإدخال HTML أو JavaScript في الوصف.");
      hasError = true;
    }

    const urlResult = localValidateArchiveUrl(urlRaw);
    let status, downloadUrl, previewUrl;
    if (urlResult.empty) {
      status = "pending";
    } else if (urlResult.valid) {
      status = "available";
      downloadUrl = urlRaw;
      previewUrl = urlRaw;
    } else {
      notify("error", "رابط Internet Archive غير صالح: " + urlResult.reason);
      hasError = true;
    }

    let order;
    if (orderRaw !== "") {
      if (!/^-?\d+$/.test(orderRaw)) {
        notify("error", "ترتيب المادة يجب أن يكون رقمًا صحيحًا.");
        hasError = true;
      } else {
        order = parseInt(orderRaw, 10);
      }
    }

    if (hasError) return;

    const id = generateMaterialId(project, title);

    const newMaterial = {
      id: id,
      title: title,
      description: description,
      fileType: fileType,
      project: project,
      section: section,
      status: status,
      __draft: true,
    };
    if (fileSize) newMaterial.fileSize = fileSize;
    if (track) newMaterial.track = track;
    if (typeof order === "number") newMaterial.order = order;
    if (status === "available") {
      newMaterial.downloadUrl = downloadUrl;
      newMaterial.previewUrl = previewUrl;
    }

    state.materials.push(newMaterial);
    dirty = true;
    closeModal("modal-add-material");
    notify("success", "أُضيفت المادة «" + title + "» إلى المسودة المحلية.");
    if (currentProjectSlug === project) renderProjectDetail();
    renderProjectList();
    updateSaveBar();
  }

  // -------------------------------------------------------------
  // نافذة: تعديل مادة
  // -------------------------------------------------------------
  //
  // ملاحظات مهمة على التصميم:
  // - id يُعرض للقراءة فقط، ولا يوجد أي طريق لتغييره من هذا النموذج.
  // - project وsection قابلان للتغيير من القيم الموجودة أصلًا، وتبقى
  //   التغييرات في المسودة المحلية حتى الضغط على الحفظ.
  // - اختيار مشروع جديد يحدّث قائمة الأقسام إلى أقسامه فقط، واختيار قسم
  //   من البحث يحدد مشروعه تلقائيًا.
  // - الحالة (status) تُحسب تلقائيًا من صلاحية الرابط، ولا يختارها
  //   المستخدم مباشرة.
  // - التعديل يُخزَّن في مسودة محلية فقط، ولا يُكتب فعليًا على القرص
  //   إلا عبر "اعتماد وحفظ" (نفس مسار الحفظ العام، الذي يأخذ نسخة
  //   احتياطية تلقائية قبل أي كتابة فعلية).

  let editingMaterialId = null;

  function openEditMaterialModal(id) {
    const m = findMaterialById(id);
    if (!m) {
      notify("error", "تعذّر العثور على المادة — ربما حُذفت بالفعل من المسودة المحلية.");
      return;
    }

    editingMaterialId = id;

    clearFieldError("editMaterialTitleError");
    clearFieldError("editMaterialDescriptionError");

    $("editMaterialId").value = m.id;
    $("editMaterialIdDisplay").textContent = m.id;
    populateProjectSelect($("editMaterialProject"), m.project);
    populateSectionSelect($("editMaterialSection"), m.project, m.section);
    hideSearchResults("editMaterialProjectSearch", "editMaterialProjectSearchResults");
    hideSearchResults("editMaterialSectionSearch", "editMaterialSectionSearchResults");
    $("editMaterialFileType").value = m.fileType || "PDF";
    $("editMaterialTitle").value = m.title || "";
    $("editMaterialDescription").value = m.description || "";
    $("editMaterialFileSize").value = m.fileSize || "";
    $("editMaterialTrack").value = m.track || "";
    $("editMaterialOrder").value = typeof m.order === "number" ? String(m.order) : "";
    $("editMaterialDownloadUrl").value = m.status === "available" ? m.downloadUrl || "" : "";

    updateEditUrlStatusDisplay();
    updateEditComputedStatus();
    updateEditMaterialPreview();

    $("modalEditMaterialTitle").textContent = "✎ تعديل مادة: " + (m.title || m.id);
    openModal("modal-edit-material");
  }

  function updateEditUrlStatusDisplay() {
    const url = $("editMaterialDownloadUrl").value;
    const line = $("editUrlStatusLine");
    const text = $("editUrlStatusText");
    const result = localValidateArchiveUrl(url);

    line.classList.remove("url-status-valid", "url-status-invalid", "url-status-pending");

    if (result.empty) {
      line.classList.add("url-status-pending");
      text.textContent = "لا يوجد رابط — ستكون حالة المادة «قيد التجهيز».";
    } else if (result.valid) {
      line.classList.add("url-status-valid");
      text.textContent = "الرابط صالح شكليًا — ستكون حالة المادة «متاحة».";
    } else {
      line.classList.add("url-status-invalid");
      text.textContent = result.reason;
    }
  }

  function updateEditComputedStatus() {
    const url = $("editMaterialDownloadUrl").value;
    const result = localValidateArchiveUrl(url);
    const statusEl = $("editMaterialComputedStatus");
    statusEl.textContent = result.valid ? "متاحة (available)" : "قيد التجهيز (pending)";
  }

  function updateEditMaterialPreview() {
    const title = $("editMaterialTitle").value.trim();
    const description = $("editMaterialDescription").value.trim();
    const fileType = $("editMaterialFileType").value;
    const fileSize = $("editMaterialFileSize").value.trim();
    const url = $("editMaterialDownloadUrl").value.trim();
    const result = localValidateArchiveUrl(url);
    const status = result.valid ? "available" : "pending";

    const container = $("editMaterialPreview");
    clearNode(container);

    const h5 = document.createElement("h5");
    h5.textContent = title || "عنوان المادة";
    container.appendChild(h5);

    const p = document.createElement("p");
    p.textContent = description || "وصف المادة سيظهر هنا.";
    container.appendChild(p);

    if (status === "available") {
      const metaP = document.createElement("p");
      metaP.textContent = fileType + (fileSize ? " — " + fileSize : "");
      container.appendChild(metaP);

      const actions = document.createElement("div");
      actions.className = "preview-material-actions";

      const dl = document.createElement("span");
      dl.className = "preview-btn preview-btn-download";
      dl.textContent = "تنزيل (معاينة بصرية فقط)";
      actions.appendChild(dl);

      const rd = document.createElement("span");
      rd.className = "preview-btn preview-btn-read";
      rd.textContent = "قراءة (معاينة بصرية فقط)";
      actions.appendChild(rd);

      container.appendChild(actions);
    } else {
      const note = document.createElement("p");
      note.className = "preview-pending-note";
      note.textContent = "المادة قيد التجهيز وستتوفر قريبًا.";
      container.appendChild(note);
    }
  }

  function handleEditMaterialSubmit() {
    clearFieldError("editMaterialTitleError");
    clearFieldError("editMaterialDescriptionError");

    if (!editingMaterialId) {
      notify("error", "تعذّر تحديد المادة المطلوب تعديلها.");
      return;
    }
    const m = findMaterialById(editingMaterialId);
    if (!m) {
      notify("error", "تعذّر العثور على المادة — ربما حُذفت بالفعل من المسودة المحلية.");
      closeModal("modal-edit-material");
      return;
    }

    const oldProject = m.project;
    const project = $("editMaterialProject").value;
    const section = $("editMaterialSection").value;
    const fileType = $("editMaterialFileType").value;
    const title = $("editMaterialTitle").value.trim();
    const description = $("editMaterialDescription").value.trim();
    const fileSize = $("editMaterialFileSize").value.trim();
    const track = $("editMaterialTrack").value.trim();
    const orderRaw = $("editMaterialOrder").value.trim();
    const urlRaw = $("editMaterialDownloadUrl").value.trim();

    let hasError = false;

    if (!project || !projectBySlug(project)) {
      notify("error", "اختر مشروعًا صحيحًا من المشاريع الموجودة.");
      hasError = true;
    }
    if (!section) {
      notify("error", "اختر القسم — أضف قسمًا للمشروع أولاً إن لم يوجد أي قسم بعد.");
      hasError = true;
    } else if (!project || !sectionByProjectAndName(project, section)) {
      notify("error", "القسم المحدد لا يتبع المشروع المحدد. اختر مشروعًا وقسمًا متوافقين.");
      hasError = true;
    }
    if (!title) {
      setFieldError("editMaterialTitleError", "عنوان المادة مطلوب.");
      hasError = true;
    } else if (containsHtml(title)) {
      setFieldError("editMaterialTitleError", "لا يُسمح بإدخال HTML أو JavaScript في العنوان.");
      hasError = true;
    }
    if (containsHtml(description)) {
      setFieldError("editMaterialDescriptionError", "لا يُسمح بإدخال HTML أو JavaScript في الوصف.");
      hasError = true;
    }

    const urlResult = localValidateArchiveUrl(urlRaw);
    let status, downloadUrl, previewUrl;
    if (urlResult.empty) {
      status = "pending";
    } else if (urlResult.valid) {
      status = "available";
      downloadUrl = urlRaw;
      previewUrl = urlRaw;
    } else {
      notify("error", "رابط Internet Archive غير صالح: " + urlResult.reason);
      hasError = true;
    }

    let order;
    if (orderRaw !== "") {
      if (!/^-?\d+$/.test(orderRaw)) {
        notify("error", "ترتيب المادة يجب أن يكون رقمًا صحيحًا.");
        hasError = true;
      } else {
        order = parseInt(orderRaw, 10);
      }
    }

    if (hasError) return;

    // تعديل الكائن الموجود في مكانه (لا استبدال كامل)، حتى لا تُفقد أي
    // حقول أخرى لم يعرضها هذا النموذج أصلًا. id لا يتغير أبدًا هنا.
    m.project = project;
    m.section = section;
    m.fileType = fileType;
    m.title = title;
    m.description = description;
    m.status = status;

    if (fileSize) {
      m.fileSize = fileSize;
    } else {
      delete m.fileSize;
    }

    if (track) {
      m.track = track;
    } else {
      delete m.track;
    }

    if (typeof order === "number") {
      m.order = order;
    } else {
      delete m.order;
    }

    if (status === "available") {
      m.downloadUrl = downloadUrl;
      m.previewUrl = previewUrl;
    } else {
      // لا نترك رابطًا قديمًا معلّقًا على مادة أصبحت قيد التجهيز.
      delete m.downloadUrl;
      delete m.previewUrl;
    }

    // إن لم تكن المادة أصلًا مسودة جديدة غير محفوظة، ضع علامة "معدّلة"
    // لتمييزها بصريًا حتى الحفظ الفعلي.
    if (!m.__draft) {
      m.__edited = true;
    }

    dirty = true;
    editingMaterialId = null;
    closeModal("modal-edit-material");
    notify("success", "تم تعديل المادة «" + title + "» في المسودة المحلية. لن يُحفظ التعديل فعليًا حتى الضغط على «اعتماد وحفظ».");
    if (currentProjectSlug === oldProject || currentProjectSlug === m.project) renderProjectDetail();
    renderProjectList();
    updateSaveBar();
  }

  // -------------------------------------------------------------
  // نافذة: تأكيد حذف مادة
  // -------------------------------------------------------------

  let pendingDeleteMaterialId = null;

  function openDeleteMaterialModal(id) {
    const m = findMaterialById(id);
    if (!m) {
      notify("error", "تعذّر العثور على المادة — ربما حُذفت بالفعل من المسودة المحلية.");
      return;
    }
    pendingDeleteMaterialId = id;
    $("deleteMaterialTitle").textContent = m.title || "(بدون عنوان)";
    $("deleteMaterialId").textContent = m.id;
    openModal("modal-confirm-delete-material");
  }

  function handleConfirmDeleteMaterial() {
    if (!pendingDeleteMaterialId) {
      closeModal("modal-confirm-delete-material");
      return;
    }
    const id = pendingDeleteMaterialId;
    const m = findMaterialById(id);
    if (!m) {
      notify("error", "تعذّر العثور على المادة — ربما حُذفت بالفعل من المسودة المحلية.");
      pendingDeleteMaterialId = null;
      closeModal("modal-confirm-delete-material");
      return;
    }

    const project = m.project;
    const title = m.title || m.id;

    // نحذف بالاعتماد على id الفعلي حصرًا، وليس على أي فهرس أو ترتيب.
    state.materials = state.materials.filter(function (x) {
      return x.id !== id;
    });

    dirty = true;
    pendingDeleteMaterialId = null;
    closeModal("modal-confirm-delete-material");
    notify("success", "حُذفت المادة «" + title + "» من المسودة المحلية. لن يُحذف أي شيء فعليًا من القرص حتى الضغط على «اعتماد وحفظ».");
    if (currentProjectSlug === project) renderProjectDetail();
    renderProjectList();
    updateSaveBar();
  }

  // -------------------------------------------------------------
  // اكتشاف المسودات/التغييرات غير المحفوظة قبل حذف مشروع أو قسم
  // -------------------------------------------------------------
  //
  // هذا الاكتشاف محلي بحت (لا اتصال بالخادم): يفحص state.sections
  // و state.materials بحثًا عن أي عنصر يحمل __draft (لم يُحفظ على القرص
  // أبدًا) أو __edited (عنصر محفوظ سابقًا لكن جرى تعديله محليًا ولم
  // يُعتمد بعد)، ضمن نطاق المشروع أو القسم المطلوب حذفه.

  function computeProjectUnsavedImpact(slug) {
    const draftSections = state.sections.filter(function (s) {
      return s.project === slug && s.__draft;
    }).length;
    const draftMaterials = state.materials.filter(function (m) {
      return m.project === slug && m.__draft;
    }).length;
    const editedMaterials = state.materials.filter(function (m) {
      return m.project === slug && m.__edited && !m.__draft;
    }).length;
    return {
      draftSections: draftSections,
      draftMaterials: draftMaterials,
      editedMaterials: editedMaterials,
      hasUnsaved: draftSections > 0 || draftMaterials > 0 || editedMaterials > 0,
    };
  }

  function computeSectionUnsavedImpact(project, name) {
    const draftMaterials = state.materials.filter(function (m) {
      return m.project === project && m.section === name && m.__draft;
    }).length;
    const editedMaterials = state.materials.filter(function (m) {
      return m.project === project && m.section === name && m.__edited && !m.__draft;
    }).length;
    return {
      draftMaterials: draftMaterials,
      editedMaterials: editedMaterials,
      hasUnsaved: draftMaterials > 0 || editedMaterials > 0,
    };
  }

  // يبني نص وصف مختصر لعدد العناصر غير المحفوظة المتأثرة، لعرضه داخل
  // مربع التحذير في نافذة التأكيد.
  function describeUnsavedImpact(impact, includeSections) {
    const parts = [];
    if (includeSections && impact.draftSections) {
      parts.push("أقسام جديدة غير محفوظة: " + impact.draftSections);
    }
    if (impact.draftMaterials) {
      parts.push("مواد جديدة غير محفوظة: " + impact.draftMaterials);
    }
    if (impact.editedMaterials) {
      parts.push("مواد معدَّلة غير محفوظة: " + impact.editedMaterials);
    }
    return parts.join("، ");
  }

  // يملأ (أو يخفي) مربع تحذير المسودات داخل نافذة تأكيد الحذف، ويضبط
  // نص زر التأكيد ليصبح «متابعة الحذف» عند وجود تغييرات غير محفوظة
  // قد تُفقد، تمييزًا له عن التأكيد المعتاد حين لا توجد أي مسودات.
  function applyDraftWarning(warnBoxId, btnId, impact, includeSections, subjectLabel) {
    const warnBox = $(warnBoxId);
    if (warnBox) {
      if (impact.hasUnsaved) {
        warnBox.hidden = false;
        warnBox.textContent =
          "تنبيه: يوجد تغييرات غير محفوظة مرتبطة بـ" + subjectLabel + " (" +
          describeUnsavedImpact(impact, includeSections) +
          "). لم تُحفظ هذه التغييرات على القرص بعد، والمتابعة في الحذف الآن ستفقدها نهائيًا ولن يمكن التراجع عنها. اضغط «إلغاء» إن أردت مراجعتها أو اعتمادها وحفظها أولًا، أو «متابعة الحذف» لتجاهلها والمتابعة.";
      } else {
        warnBox.hidden = true;
        warnBox.textContent = "";
      }
    }
    const btn = $(btnId);
    if (btn) {
      btn.disabled = false;
      btn.textContent = impact.hasUnsaved ? "متابعة الحذف" : "تأكيد الحذف";
    }
  }

  // -------------------------------------------------------------
  // نافذة: تأكيد حذف مشروع
  // -------------------------------------------------------------
  //
  // حذف مشروع فعل فوري غير قابل للتراجع من الواجهة، لذلك — خلافًا لحذف
  // مادة من المسودة المحلية — يُرسل مباشرة إلى الخادم فور الضغط على زر
  // «تأكيد الحذف» المنفصل، تمامًا كإنشاء مشروع وتعديله. الخادم يأخذ
  // نسخة احتياطية تلقائية من data/materials.js (ومن صفحة المشروع إن
  // وُجدت) قبل أي حذف فعلي.

  let pendingDeleteProjectSlug = null;

  function openDeleteProjectModal(slug) {
    const p = state.projects.find(function (x) {
      return x.slug === slug;
    });
    if (!p) {
      notify("error", "تعذّر العثور على المشروع — ربما حُذف بالفعل.");
      return;
    }

    const sectionsCount = state.sections.filter(function (s) {
      return s.project === slug;
    }).length;
    const materialsCount = state.materials.filter(function (m) {
      return m.project === slug;
    }).length;

    pendingDeleteProjectSlug = slug;
    $("deleteProjectName").textContent = p.name || "(بدون اسم)";
    $("deleteProjectSlug").textContent = p.slug;
    $("deleteProjectCounts").textContent =
      "عدد الأقسام المتأثرة: " + sectionsCount + " — عدد المواد المتأثرة: " + materialsCount;

    const summaryContainer = $("deleteProjectSummary");
    clearNode(summaryContainer);
    summaryContainer.appendChild(buildProjectSummary(slug));

    const impact = computeProjectUnsavedImpact(slug);
    applyDraftWarning("deleteProjectDraftWarning", "confirmDeleteProjectBtn", impact, true, "هذا المشروع");

    openModal("modal-confirm-delete-project");
  }

  async function handleConfirmDeleteProject() {
    if (!pendingDeleteProjectSlug) {
      closeModal("modal-confirm-delete-project");
      return;
    }
    const slug = pendingDeleteProjectSlug;
    const p = state.projects.find(function (x) {
      return x.slug === slug;
    });
    const title = p ? p.name || p.slug : slug;

    const btn = $("confirmDeleteProjectBtn");
    const originalBtnText = btn ? btn.textContent : "تأكيد الحذف";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "جارٍ الحذف…";
    }

    try {
      const res = await fetch(ENDPOINTS.projectsDelete, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slug, confirm: CONFIRM_TOKEN }),
      });
      const data = await res.json();

      if (data.ok && data.saved) {
        pendingDeleteProjectSlug = null;
        closeModal("modal-confirm-delete-project");
        notify(
          "success",
          "تم حذف المشروع «" + title + "» بنجاح — الأقسام المحذوفة: " +
            data.deletedSectionsCount + "، المواد المحذوفة: " + data.deletedMaterialsCount +
            ". نسخة احتياطية: " + data.backup
        );
        // loadData() تعيد ضبط currentProjectSlug وتعرض قائمة المشاريع
        // تلقائيًا، فلا تبقى أي بطاقة أو تفاصيل للمشروع المحذوف ظاهرة.
        await loadData();
      } else {
        notify("error", "فشل حذف المشروع: " + (data.error || "خطأ غير معروف من الخادم."));
      }
    } catch (err) {
      notify(
        "error",
        "تعذّر الاتصال بخادم الإدارة أثناء حذف المشروع. لم يُحذف أي شيء فعليًا."
      );
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalBtnText;
      }
    }
  }

  // -------------------------------------------------------------
  // نافذة: تأكيد حذف قسم
  // -------------------------------------------------------------

  let pendingDeleteSection = null; // { project, name }

  function openDeleteSectionModal(project, name) {
    const section = state.sections.find(function (s) {
      return s.project === project && s.name === name;
    });

    // قسم مسودة لم يُحفظ بعد على القرص أصلًا: عرض نافذة حذف عادية هنا
    // سيكون مضللًا (توحي بحذف فعلي ونسخة احتياطية لشيء غير موجود فعليًا
    // في البيانات المحفوظة). بدلًا من ذلك، نُزيله من النموذج المحلي فورًا
    // دون أي اتصال بالخادم ودون نسخة احتياطية، ودون المساس ببقية المسودات.
    if (section && section.__draft) {
      removeDraftSectionFromForm(project, name);
      return;
    }

    const materialsCount = state.materials.filter(function (m) {
      return m.project === project && m.section === name;
    }).length;

    pendingDeleteSection = { project: project, name: name };
    $("deleteSectionName").textContent = name;
    $("deleteSectionProjectName").textContent = projectNameForSlug(project);
    $("deleteSectionCounts").textContent =
      "عدد الأقسام المتأثرة: 1 — عدد المواد المتأثرة: " + materialsCount;

    const impact = computeSectionUnsavedImpact(project, name);
    applyDraftWarning("deleteSectionDraftWarning", "confirmDeleteSectionBtn", impact, false, "هذا القسم");

    openModal("modal-confirm-delete-section");
  }

  // يزيل قسم مسودة (لم يُحفظ فعليًا بعد) من النموذج المحلي فقط، دون أي
  // اتصال بالخادم، ودون تغيير data/materials.js، ودون إنشاء نسخة احتياطية.
  function removeDraftSectionFromForm(project, name) {
    state.sections = state.sections.filter(function (s) {
      return !(s.project === project && s.name === name);
    });

    // أي مادة مسودة (لم تُحفظ هي الأخرى بعد) أُنشئت خصيصًا داخل هذا
    // القسم المسودة لا معنى لبقائها بعد إزالة القسم نفسه من النموذج،
    // فتُزال معه. المواد المحفوظة فعليًا التي جرى تعديلها لنقلها إلى هذا
    // القسم (__edited) لا تُمس هنا؛ لا تُفقد بياناتها، ويبقى بإمكان
    // المستخدم إعادة تعيين قسمها قبل الاعتماد والحفظ.
    const removedDraftMaterials = state.materials.filter(function (m) {
      return m.project === project && m.section === name && m.__draft;
    }).length;
    state.materials = state.materials.filter(function (m) {
      return !(m.project === project && m.section === name && m.__draft);
    });

    let msg =
      "القسم «" + name + "» مسودة غير محفوظة بعد، فأُزيل من النموذج المحلي فقط. " +
      "لم يتغيّر أي شيء في البيانات المحفوظة على القرص، ولم تُنشأ أي نسخة احتياطية.";
    if (removedDraftMaterials > 0) {
      msg += " وأُزيلت معه " + removedDraftMaterials + " مادة مسودة كانت داخله ولم تُحفظ هي الأخرى بعد.";
    }
    notify("success", msg);

    if (currentProjectSlug === project) renderProjectDetail();
    renderProjectList();
    updateSaveBar();
  }

  async function handleConfirmDeleteSection() {
    if (!pendingDeleteSection) {
      closeModal("modal-confirm-delete-section");
      return;
    }
    const project = pendingDeleteSection.project;
    const name = pendingDeleteSection.name;

    const btn = $("confirmDeleteSectionBtn");
    const originalBtnText = btn ? btn.textContent : "تأكيد الحذف";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "جارٍ الحذف…";
    }

    try {
      const res = await fetch(ENDPOINTS.sectionsDelete, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section: { project: project, name: name },
          confirm: CONFIRM_TOKEN,
        }),
      });
      const data = await res.json();

      if (data.ok && data.saved) {
        pendingDeleteSection = null;
        closeModal("modal-confirm-delete-section");
        notify(
          "success",
          "تم حذف القسم «" + name + "» بنجاح — المواد المحذوفة: " +
            data.deletedMaterialsCount + ". نسخة احتياطية: " + data.backup
        );
        await loadData();
        // المشروع نفسه وبقية أقسامه لم يُمسّا؛ نعيد فتح تفاصيله بعد
        // إعادة التحميل حتى يرى المستخدم القائمة المحدَّثة فورًا بدل
        // العودة لقائمة كل المشاريع.
        openProjectDetail(project);
      } else {
        notify("error", "فشل حذف القسم: " + (data.error || "خطأ غير معروف من الخادم."));
      }
    } catch (err) {
      notify(
        "error",
        "تعذّر الاتصال بخادم الإدارة أثناء حذف القسم. لم يُحذف أي شيء فعليًا."
      );
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalBtnText;
      }
    }
  }

  // -------------------------------------------------------------
  // شريط الحفظ وتجميع البيانات وإرسالها
  // -------------------------------------------------------------

  function updateSaveBar() {
    const bar = $("saveBar");
    if (!dirty) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const newProjects = state.projects.filter(function (p) { return p.__draft; }).length;
    const newSections = state.sections.filter(function (s) { return s.__draft; }).length;
    const newMaterials = state.materials.filter(function (m) { return m.__draft; }).length;
    const editedMaterials = state.materials.filter(function (m) { return m.__edited && !m.__draft; }).length;
    const parts = [];
    if (newProjects) parts.push(newProjects + " مشروع جديد");
    if (newSections) parts.push(newSections + " قسم جديد");
    if (newMaterials) parts.push(newMaterials + " مادة جديدة");
    if (editedMaterials) parts.push(editedMaterials + " مادة معدّلة");
    $("saveBarStatus").textContent = "تغييرات غير محفوظة: " + (parts.join("، ") || "تعديلات محلية");
  }

  function validatePayloadClientSide() {
    const errors = [];

    const slugs = state.projects.map(function (p) { return p.slug; });
    if (new Set(slugs).size !== slugs.length) errors.push("يوجد slug مشروع مكرر — لا يمكن الحفظ.");
    if (slugs.some(function (s) { return !s; })) errors.push("يوجد مشروع بلا slug صالح.");

    const ids = state.materials.map(function (m) { return m.id; });
    if (new Set(ids).size !== ids.length) errors.push("يوجد id مادة مكرر — لا يمكن الحفظ.");
    if (ids.some(function (i) { return !i; })) errors.push("يوجد مادة بلا id صالح.");

    const slugSet = new Set(slugs);

    state.materials.forEach(function (m) {
      if (!slugSet.has(m.project)) {
        errors.push("المادة «" + (m.title || m.id) + "» تشير إلى مشروع غير موجود.");
      }
      if (!m.section) {
        errors.push("المادة «" + (m.title || m.id) + "» يجب أن تكون داخل قسم صحيح.");
      } else if (!sectionByProjectAndName(m.project, m.section)) {
        errors.push("المادة «" + (m.title || m.id) + "» داخل قسم لا يتبع مشروعها.");
      }
      if (m.status === "available") {
        const r = localValidateArchiveUrl(m.downloadUrl);
        if (!r.valid) errors.push("المادة «" + (m.title || m.id) + "» حالتها متاحة لكن رابطها غير صالح.");
      }
      if (containsHtml(m.title) || containsHtml(m.description)) {
        errors.push("المادة «" + (m.title || m.id) + "» تحتوي على محتوى HTML غير مسموح.");
      }
    });

    state.projects.forEach(function (p) {
      if (containsHtml(p.name) || containsHtml(p.description)) {
        errors.push("المشروع «" + (p.name || p.slug) + "» يحتوي على محتوى HTML غير مسموح.");
      }
    });

    const seenSectionKeys = new Set();
    state.sections.forEach(function (s) {
      if (!slugSet.has(s.project)) {
        errors.push("القسم «" + (s.name || "") + "» يشير إلى مشروع غير موجود.");
      }
      if (containsHtml(s.name) || containsHtml(s.description)) {
        errors.push("القسم «" + (s.name || "") + "» يحتوي على محتوى HTML غير مسموح.");
      }
      const key = s.project + "|||" + s.name;
      if (seenSectionKeys.has(key)) {
        errors.push("يوجد قسم مكرر بنفس الاسم ضمن نفس المشروع: «" + s.name + "».");
      }
      seenSectionKeys.add(key);
    });

    return errors;
  }

  function stripInternalFlags(obj) {
    const copy = Object.assign({}, obj);
    delete copy.__draft;
    delete copy.__edited;
    return copy;
  }

  function assemblePayload() {
    return {
      confirm: CONFIRM_TOKEN,
      projects: state.projects.map(stripInternalFlags),
      materials: state.materials.map(stripInternalFlags),
      sections: state.sections.map(stripInternalFlags),
    };
  }

  function renderSaveSummary() {
    const el = $("saveSummary");
    clearNode(el);

    const heading = document.createElement("p");
    heading.className = "save-summary-heading";
    heading.textContent = "سيتم حفظ:";
    el.appendChild(heading);

    const ul = document.createElement("ul");
    [
      "المشاريع: " + state.projects.length,
      "الأقسام: " + state.sections.length,
      "المواد: " + state.materials.length,
    ].forEach(function (text) {
      const li = document.createElement("li");
      li.textContent = text;
      ul.appendChild(li);
    });
    el.appendChild(ul);

    const newProjects = state.projects.filter(function (p) { return p.__draft; }).length;
    const newSections = state.sections.filter(function (s) { return s.__draft; }).length;
    const newMaterials = state.materials.filter(function (m) { return m.__draft; }).length;
    const editedMaterials = state.materials.filter(function (m) { return m.__edited && !m.__draft; }).length;

    if (newProjects || newSections || newMaterials || editedMaterials) {
      const ulUnsaved = document.createElement("ul");
      ulUnsaved.className = "save-summary-unsaved";
      if (newProjects) {
        const li = document.createElement("li");
        li.textContent = "المشاريع الجديدة غير المحفوظة: " + newProjects;
        ulUnsaved.appendChild(li);
      }
      if (newSections) {
        const li = document.createElement("li");
        li.textContent = "الأقسام الجديدة غير المحفوظة: " + newSections;
        ulUnsaved.appendChild(li);
      }
      if (newMaterials) {
        const li = document.createElement("li");
        li.textContent = "المواد الجديدة غير المحفوظة: " + newMaterials;
        ulUnsaved.appendChild(li);
      }
      if (editedMaterials) {
        const li = document.createElement("li");
        li.textContent = "المواد المعدَّلة غير المحفوظة: " + editedMaterials;
        ulUnsaved.appendChild(li);
      }
      el.appendChild(ulUnsaved);
    }
  }

  async function doSave() {
    const btn = $("confirmSaveBtn");
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "جارٍ الحفظ…";

    try {
      const payload = assemblePayload();
      const res = await fetch(ENDPOINTS.save, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.ok && data.saved) {
        closeModal("modal-confirm-save");
        notify(
          "success",
          "تم الحفظ فعليًا. عدد المواد الآن: " +
            (typeof data.materialsCount === "number" ? data.materialsCount : state.materials.length) +
            ". نسخة احتياطية: " +
            (data.backup || "") +
            "."
        );
        await loadData();
      } else {
        const sent = payload.projects.length + " مشروع، " + payload.sections.length + " قسم، " + payload.materials.length + " مادة";
        let msg = "فشل الحفظ (HTTP " + res.status + "): " + (data.error || "خطأ غير معروف من الخادم.");
        msg += " — المُرسَل: " + sent + ".";
        if (data.received) {
          msg += " الموجود على الخادم بحسب الرد: " + data.received.projects + " مشروع، " + data.received.sections + " قسم، " + data.received.materials + " مادة.";
        }
        notify("error", msg);
      }
    } catch (err) {
      notify("error", "تعذّر الاتصال بخادم الإدارة أثناء الحفظ. لم تُفقد بياناتك المحلية، يمكنك المحاولة مرة أخرى.");
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // -------------------------------------------------------------
  // نوافذ منبثقة (Modals)
  // -------------------------------------------------------------

  // عناصر قابلة للتركيز عبر لوحة المفاتيح داخل حاوية معيّنة (تُستخدم
  // لحصر التنقّل بـ Tab داخل النافذة المنبثقة المفتوحة فقط).
  function getFocusable(container) {
    if (!container) return [];
    const nodes = container.querySelectorAll(
      'a[href], button:not([disabled]), textarea:not([disabled]), ' +
      'input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
      '[tabindex]:not([tabindex="-1"])'
    );
    return Array.prototype.filter.call(nodes, function (el) {
      return el.offsetParent !== null;
    });
  }

  function openModal(id) {
    const overlay = $(id);
    if (!overlay) return;
    // نحفظ العنصر الذي كان يحمل التركيز (عادة الزر الذي فتح النافذة)
    // لإعادة التركيز إليه تلقائيًا عند الإغلاق.
    lastFocusedBeforeModal = document.activeElement;
    overlay.hidden = false;
    const modal = overlay.querySelector(".modal");
    // ننقل التركيز إلى أول عنصر تفاعلي داخل النافذة (عادة زر الإغلاق
    // ✕)، أو إلى حاوية النافذة نفسها إن لم يوجد أي عنصر تفاعلي.
    window.requestAnimationFrame(function () {
      const focusables = getFocusable(modal);
      (focusables[0] || modal).focus();
    });
  }

  function closeModal(id) {
    const overlay = $(id);
    if (!overlay) return;
    overlay.hidden = true;
    // إعادة التركيز إلى العنصر الذي فتح النافذة، حتى لا يفقد مستخدم
    // لوحة المفاتيح أو قارئ الشاشة موضعه في الصفحة بعد الإغلاق.
    if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === "function") {
      lastFocusedBeforeModal.focus();
    }
    lastFocusedBeforeModal = null;
  }

  // حصر التنقّل بـ Tab / Shift+Tab داخل النافذة المنبثقة المفتوحة حاليًا
  // فقط (focus trap)، بحيث لا يخرج التركيز إلى محتوى الصفحة خلف الطبقة
  // المعتمة.
  function trapModalFocus(e) {
    if (e.key !== "Tab") return;
    const openOverlay = document.querySelector(".modal-overlay:not([hidden])");
    if (!openOverlay) return;
    const modal = openOverlay.querySelector(".modal");
    const focusables = getFocusable(modal);
    if (!focusables.length) {
      e.preventDefault();
      modal.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first || !modal.contains(document.activeElement)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last || !modal.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // إغلاق أي قائمة نتائج بحث مفتوحة (البحث السريع العام، أو حقول
  // البحث الداخلية عن مشروع/قسم داخل النماذج) عبر Escape.
  function closeOpenSearchDropdowns() {
    let closedAny = false;
    document.querySelectorAll(".search-results").forEach(function (el) {
      if (!el.hidden) {
        el.hidden = true;
        clearNode(el);
        closedAny = true;
      }
    });
    return closedAny;
  }

  // -------------------------------------------------------------
  // ربط أحداث الواجهة
  // -------------------------------------------------------------

  function wireEvents() {
    on("retryLoadBtn", "click", loadData);
    on("backToListBtn", "click", function () {
      currentProjectSlug = null;
      showListView();
    });

    on("globalSearchInput", "input", function () {
      const query = $("globalSearchInput").value;
      const results = $("globalSearchResults");
      if (!query.trim()) {
        clearNode(results);
        results.hidden = true;
        return;
      }
       renderSearchResults(results, searchAll(query), selectGlobalSearchResult, query);
    });

    // إغلاق النوافذ المنبثقة
    document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        closeModal(btn.getAttribute("data-close-modal"));
      });
    });
    document.querySelectorAll(".modal-overlay").forEach(function (overlay) {
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) closeModal(overlay.id);
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        const openOverlay = document.querySelector(".modal-overlay:not([hidden])");
        if (openOverlay) {
          // إغلاق النافذة المنبثقة المفتوحة حاليًا فقط (مع إعادة
          // التركيز تلقائيًا إلى الزر الذي فتحها، عبر closeModal).
          closeModal(openOverlay.id);
        } else {
          // لا توجد نافذة مفتوحة: أغلق أي قائمة نتائج بحث مفتوحة
          // (البحث السريع العام أو حقول البحث الداخلية) إن وُجدت.
          closeOpenSearchDropdowns();
        }
        return;
      }
      // حصر التنقّل بـ Tab/Shift+Tab داخل النافذة المنبثقة المفتوحة.
      trapModalFocus(e);
    });

    // نافذة إضافة مشروع
    on("openAddProjectBtn", "click", function () {
      resetAddProjectForm();
      openModal("modal-add-project");
    });
    on("projectName", "input", updateProjectPreview);
    on("projectDescription", "input", updateProjectPreview);
    on("submitAddProjectBtn", "click", handleAddProjectSubmit);

    // نافذة تعديل مشروع
    on("submitEditProjectBtn", "click", handleEditProjectSubmit);

    // نافذة تعديل قسم
    on("submitEditSectionBtn", "click", handleEditSectionSubmit);

    // نافذة إضافة قسم
    on("openAddSectionBtn", "click", function () {
      resetAddSectionForm();
      populateProjectSelect($("sectionProject"), currentProjectSlug);
      openModal("modal-add-section");
    });
    on("submitAddSectionBtn", "click", handleAddSectionSubmit);

    // نافذة إضافة مادة
    on("openAddMaterialBtn", "click", function () {
      resetAddMaterialForm();
      populateProjectSelect($("materialProject"), currentProjectSlug);
      populateSectionSelect($("materialSection"), currentProjectSlug);
      updateMaterialPreview();
      openModal("modal-add-material");
    });
    on("materialProject", "change", function () {
      populateSectionSelect($("materialSection"), $("materialProject").value);
      updateMaterialPreview();
    });
    on("editMaterialProject", "change", function () {
      populateSectionSelect($("editMaterialSection"), $("editMaterialProject").value);
      updateEditMaterialPreview();
    });
    wireMaterialSearch("material");
    wireMaterialSearch("editMaterial");
    on("materialTitle", "input", updateMaterialPreview);
    on("materialDescription", "input", updateMaterialPreview);
    on("materialFileType", "change", updateMaterialPreview);
    on("materialFileSize", "input", updateMaterialPreview);
    on("materialDownloadUrl", "input", function () {
      updateUrlStatusDisplay();
      updateComputedStatus();
      updateMaterialPreview();
    });
    on("checkUrlBtn", "click", async function () {
      const url = $("materialDownloadUrl").value;
      const btn = $("checkUrlBtn");
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = "جارٍ التحقق…";
      try {
        const res = await fetch(ENDPOINTS.validateUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url }),
        });
        const data = await res.json();
        const line = $("urlStatusLine");
        const text = $("urlStatusText");
        line.classList.remove("url-status-valid", "url-status-invalid", "url-status-pending");
        if (data.ok && data.valid) {
          line.classList.add("url-status-valid");
          text.textContent = "تحقّق الخادم: الرابط صالح شكليًا.";
        } else if (data.ok) {
          line.classList.add("url-status-invalid");
          text.textContent = "تحقّق الخادم: " + (data.reason || "الرابط غير صالح.");
        } else {
          notify("error", data.error || "تعذّر التحقق من الرابط.");
        }
      } catch (err) {
        notify("error", "تعذّر الاتصال بخادم الإدارة للتحقق من الرابط.");
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
    on("submitAddMaterialBtn", "click", handleAddMaterialSubmit);

    // نافذة تعديل مادة
    on("editMaterialSection", "change", updateEditMaterialPreview);
    on("editMaterialFileType", "change", updateEditMaterialPreview);
    on("editMaterialTitle", "input", updateEditMaterialPreview);
    on("editMaterialDescription", "input", updateEditMaterialPreview);
    on("editMaterialFileSize", "input", updateEditMaterialPreview);
    on("editMaterialDownloadUrl", "input", function () {
      updateEditUrlStatusDisplay();
      updateEditComputedStatus();
      updateEditMaterialPreview();
    });
    on("editCheckUrlBtn", "click", async function () {
      const url = $("editMaterialDownloadUrl").value;
      const btn = $("editCheckUrlBtn");
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = "جارٍ التحقق…";
      try {
        const res = await fetch(ENDPOINTS.validateUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url }),
        });
        const data = await res.json();
        const line = $("editUrlStatusLine");
        const text = $("editUrlStatusText");
        line.classList.remove("url-status-valid", "url-status-invalid", "url-status-pending");
        if (data.ok && data.valid) {
          line.classList.add("url-status-valid");
          text.textContent = "تحقّق الخادم: الرابط صالح شكليًا.";
        } else if (data.ok) {
          line.classList.add("url-status-invalid");
          text.textContent = "تحقّق الخادم: " + (data.reason || "الرابط غير صالح.");
        } else {
          notify("error", data.error || "تعذّر التحقق من الرابط.");
        }
      } catch (err) {
        notify("error", "تعذّر الاتصال بخادم الإدارة للتحقق من الرابط.");
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
    on("submitEditMaterialBtn", "click", handleEditMaterialSubmit);

    // نافذة تأكيد حذف مادة
    on("confirmDeleteMaterialBtn", "click", handleConfirmDeleteMaterial);

    // نافذة تأكيد حذف مشروع
    on("confirmDeleteProjectBtn", "click", handleConfirmDeleteProject);

    // نافذة تأكيد حذف قسم
    on("confirmDeleteSectionBtn", "click", handleConfirmDeleteSection);

    // شريط الحفظ ونافذة التأكيد
    on("saveAllBtn", "click", function () {
      const errors = validatePayloadClientSide();
      if (errors.length) {
        notify("error", errors[0]);
        return;
      }
      renderSaveSummary();
      openModal("modal-confirm-save");
    });
    on("confirmSaveBtn", "click", doSave);
  }

  // -------------------------------------------------------------
  // نقطة الانطلاق
  // -------------------------------------------------------------

  document.addEventListener("DOMContentLoaded", function () {
    try {
      wireEvents();
    } catch (err) {
      // حتى لو فشل ربط بعض الأحداث لسبب غير متوقع، يجب ألا يمنع هذا
      // تحميل بيانات المشاريع وعرضها.
      console.error("[admin] خطأ أثناء ربط الأحداث (wireEvents):", err);
    }
    loadData();
  });
})();
