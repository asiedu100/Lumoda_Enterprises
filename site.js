document.getElementById('year').textContent = new Date().getFullYear();

// Hero background crossfade carousel
(function () {
  var slides = document.querySelectorAll('.hero-bg');
  if (slides.length < 2) return;
  var i = 0;
  setInterval(function () {
    slides[i].classList.remove('active');
    i = (i + 1) % slides.length;
    slides[i].classList.add('active');
  }, 5000);
})();

// Scroll-reveal animation
(function () {
  var targets = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || !targets.length) {
    targets.forEach(function (el) { el.classList.add('in-view'); });
    return;
  }
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in-view');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  targets.forEach(function (el) { observer.observe(el); });
})();

// Category photo lightbox
(function () {
  var GALLERIES = {
    bowls: ['images/bowls.jpg', 'images/bowls-2.jpg', 'images/bowls-3.jpg', 'images/bowls-4.jpg'],
    cookware: ['images/cookware.jpg', 'images/cookware-2.jpg'],
    glassware: ['images/glassware.jpg', 'images/glassware-2.jpg'],
    knives: ['images/knives.jpg', 'images/knives-2.jpg'],
    tools: ['images/tools.jpg', 'images/tools-2.jpg'],
    appliances: ['images/appliances-1.jpg', 'images/appliances-2.jpg']
  };

  var lightbox = document.getElementById('lightbox');
  var stageImg = document.getElementById('lightbox-img');
  var titleEl = document.getElementById('lightbox-title');
  var countEl = document.getElementById('lightbox-count');
  if (!lightbox) return;

  var current = { key: null, index: 0 };

  function show(key, index) {
    var images = GALLERIES[key];
    if (!images) return;
    current.key = key;
    current.index = (index + images.length) % images.length;
    stageImg.classList.remove('shown');
    var src = images[current.index];
    var loader = new Image();
    loader.onload = function () {
      stageImg.src = src;
      requestAnimationFrame(function () { stageImg.classList.add('shown'); });
    };
    loader.src = src;
    titleEl.textContent = key;
    countEl.textContent = (current.index + 1) + ' / ' + images.length;
  }

  function open(key) {
    show(key, 0);
    lightbox.classList.add('open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    lightbox.classList.remove('open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  document.querySelectorAll('[data-gallery]').forEach(function (tile) {
    tile.addEventListener('click', function (e) {
      e.preventDefault();
      open(tile.getAttribute('data-gallery'));
    });
  });

  document.getElementById('lightbox-close').addEventListener('click', close);
  document.getElementById('lightbox-prev').addEventListener('click', function () {
    show(current.key, current.index - 1);
  });
  document.getElementById('lightbox-next').addEventListener('click', function () {
    show(current.key, current.index + 1);
  });
  lightbox.addEventListener('click', function (e) {
    if (e.target === lightbox) close();
  });
  document.addEventListener('keydown', function (e) {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') show(current.key, current.index - 1);
    if (e.key === 'ArrowRight') show(current.key, current.index + 1);
  });
})();
