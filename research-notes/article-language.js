(() => {
  const toggle = document.querySelector("[data-article-language]");
  if (!toggle) return;

  const currentLanguage = document.documentElement.lang.startsWith("en") ? "en" : "zh";
  const targetLanguage = toggle.dataset.articleLanguage;
  const savedLanguage = localStorage.getItem("site-language");

  if (savedLanguage && savedLanguage !== currentLanguage) {
    window.location.replace(toggle.href);
    return;
  }

  toggle.addEventListener("click", () => {
    localStorage.setItem("site-language", targetLanguage);
  });
})();
