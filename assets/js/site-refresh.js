/**
 * site-refresh.js — زر اختياري صغير "تحديث الموقع" في تذييل كل صفحة.
 *
 * لا علاقة له بمنطق عرض البيانات في app.js (البطاقات، الإحصاءات،
 * الـ Accordion، زر المشاركة) ولا يعدّل أي منها. وظيفته الوحيدة:
 * إعادة تحميل الصفحة الحالية (location.reload) عند الضغط عليه، حتى
 * يحصل الزائر فورًا على آخر نسخة منشورة إن أراد ذلك يدويًا، دون أن
 * يحتاج لهذا الزر في الاستخدام العادي (التحديثات تظهر تلقائيًا مع أي
 * إعادة تحميل عادية للصفحة بفضل ترقيم الإصدار على الملفات المتغيّرة).
 *
 * لا يستخدم Service Worker ولا أي تخزين محلي (localStorage/sessionStorage)
 * ولا أي طلب شبكة إضافي.
 */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var footerContainer = document.querySelector(".site-footer .container");
    if (!footerContainer) return;

    var button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--secondary site-refresh-btn";
    button.textContent = "تحديث الموقع";
    button.setAttribute(
      "aria-label",
      "تحديث الموقع لعرض آخر نسخة منشورة الآن"
    );
    button.addEventListener("click", function () {
      window.location.reload();
    });

    footerContainer.appendChild(button);
  });
})();
