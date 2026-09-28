(function () {
  'use strict';

  // Icône affichée devant chaque type d'activité. Une nouvelle catégorie
  // ajoutée dans l'admin fonctionne aussi sans icône (🤝 par défaut).
  var ICONES = {
    'Animaux': '🐾',
    'Nature et jardinage': '🌱',
    'Aide alimentaire': '🥕',
    'Personnes âgées': '👵',
    'Enfants et jeunes': '🧒',
    'Culture et loisirs': '📚',
    'Seconde main et recyclage': '♻️',
    'Sport': '⚽',
    'Accueil et convivialité': '☕'
  };
  var ENGAGEMENT = {
    'Ponctuel': 'De temps en temps',
    'Régulier': 'Régulièrement',
    'Flexible': 'Quand vous voulez'
  };

  var state = {
    lieux: [],
    origine: null,       // { lat, lng } : jamais enregistré ni envoyé à notre serveur
    categories: new Set(),
    vue: 'list'
  };
  var carte = null;
  var calqueMarqueurs = null;

  var $ = function (id) { return document.getElementById(id); };

  function echapper(texte) {
    return String(texte == null ? '' : texte)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function icone(categorie) { return ICONES[categorie] || '🤝'; }

  function lireCoordonnees(texte) {
    var m = String(texte || '').match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }

  function distanceKm(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function formatDistance(km) {
    if (km < 1) return 'à ' + Math.max(100, Math.round(km * 10) * 100) + ' m';
    if (km < 10) return 'à ' + km.toFixed(1).replace('.', ',') + ' km';
    return 'à ' + Math.round(km) + ' km';
  }

  function slug(texte) {
    return String(texte).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  function lienWeb(url) {
    if (!url) return '';
    return /^https?:\/\//i.test(url) ? url : 'https://' + url;
  }

  // ---------- Chargement des données ----------

  function charger() {
    fetch('lieux.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (donnees) {
        var liste = Array.isArray(donnees) ? donnees : Object.values(donnees || {});
        state.lieux = liste
          .filter(function (l) { return l && l.nom && l.actif !== false; })
          .map(function (l, i) {
            l.position = lireCoordonnees(l.coordonnees);
            l.categories = Array.isArray(l.categories) ? l.categories : (l.categories ? [l.categories] : []);
            l.id = 'lieu-' + slug(l.nom) + '-' + i;
            return l;
          });
        construireFiltres();
        afficher();
      })
      .catch(function () {
        $('list').innerHTML = '<li class="empty">Désolé, la liste des lieux n\'a pas pu être chargée. Réessayez dans quelques instants.</li>';
      });
  }

  // ---------- Filtres ----------

  function construireFiltres() {
    var toutes = new Set();
    state.lieux.forEach(function (l) { l.categories.forEach(function (c) { toutes.add(c); }); });
    var conteneur = $('category-filters');
    conteneur.innerHTML = '';
    Array.from(toutes).sort(function (a, b) { return a.localeCompare(b, 'fr'); }).forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('aria-pressed', 'false');
      b.textContent = icone(c) + ' ' + c;
      b.addEventListener('click', function () {
        if (state.categories.has(c)) state.categories.delete(c); else state.categories.add(c);
        b.setAttribute('aria-pressed', String(state.categories.has(c)));
        afficher();
      });
      conteneur.appendChild(b);
    });
  }

  function lieuxFiltres() {
    var douceur = $('f-douceur').checked, accueil = $('f-accueil').checked, pmr = $('f-pmr').checked;
    var res = state.lieux.filter(function (l) {
      if (state.categories.size && !l.categories.some(function (c) { return state.categories.has(c); })) return false;
      if (douceur && !l.debut_en_douceur) return false;
      if (accueil && !l.accueil_adapte) return false;
      if (pmr && l.pmr !== 'Oui') return false;
      return true;
    });
    res.forEach(function (l) {
      l.distance = (state.origine && l.position) ? distanceKm(state.origine, l.position) : null;
    });
    res.sort(function (a, b) {
      if (state.origine) {
        if (a.distance == null) return 1;
        if (b.distance == null) return -1;
        return a.distance - b.distance;
      }
      return (a.commune || '').localeCompare(b.commune || '', 'fr') || a.nom.localeCompare(b.nom, 'fr');
    });
    return res;
  }

  // ---------- Affichage ----------

  function carteHTML(l) {
    var h = '';
    h += '<li class="card" id="' + l.id + '">';
    h += '<div class="card-top"><div><h3>' + echapper(l.nom) + '</h3>';
    h += '<p class="place">' + echapper(l.commune) + '</p></div>';
    if (l.distance != null) h += '<span class="distance">' + formatDistance(l.distance) + '</span>';
    h += '</div>';

    if (l.categories.length) {
      h += '<ul class="tags">' + l.categories.map(function (c) {
        return '<li class="tag">' + icone(c) + ' ' + echapper(c) + '</li>';
      }).join('') + '</ul>';
    }
    if (l.description) h += '<p class="desc">' + echapper(l.description) + '</p>';

    var badges = [];
    if (l.debut_en_douceur) badges.push('🌤️ Possible de commencer en douceur');
    if (l.accueil_adapte) badges.push('🤗 Habitué à accueillir des personnes fragilisées');
    if (l.engagement) badges.push('🗓️ ' + echapper(ENGAGEMENT[l.engagement] || l.engagement) +
      (l.engagement_details ? ' – ' + echapper(l.engagement_details) : ''));
    if (l.pmr === 'Oui') badges.push('♿ Accessible en fauteuil roulant');
    else if (l.pmr === 'En partie') badges.push('♿ Accessible en partie aux personnes à mobilité réduite');
    if (badges.length) h += '<ul class="badges">' + badges.map(function (b) { return '<li>' + b + '</li>'; }).join('') + '</ul>';

    h += '<details><summary>Voir les infos pratiques</summary><dl class="info">';
    var adresse = [l.adresse, [l.code_postal, l.commune].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (adresse) h += '<div><dt>Adresse</dt><dd>' + echapper(adresse) + '</dd></div>';
    if (l.horaires) h += '<div><dt>Quand</dt><dd>' + echapper(l.horaires) + '</dd></div>';
    if (l.personne_reference) h += '<div><dt>Qui demander</dt><dd>' + echapper(l.personne_reference) + '</dd></div>';
    if (l.transports) h += '<div><dt>En bus ou en train</dt><dd>' + echapper(l.transports) + '</dd></div>';
    if (l.telephone) h += '<div><dt>Téléphone</dt><dd>' + echapper(l.telephone) + '</dd></div>';
    if (l.email) h += '<div><dt>E-mail</dt><dd>' + echapper(l.email) + '</dd></div>';
    h += '</dl><div class="actions">';
    if (l.telephone) h += '<a class="main" href="tel:' + echapper(l.telephone.replace(/[^\d+]/g, '')) + '">📞 Appeler</a>';
    if (l.email) h += '<a href="mailto:' + echapper(l.email) + '">✉️ Écrire</a>';
    if (l.position) {
      h += '<a href="https://www.google.com/maps/dir/?api=1&amp;destination=' + l.position.lat + ',' + l.position.lng +
        '&amp;travelmode=transit" target="_blank" rel="noopener">🚌 Itinéraire en bus/train</a>';
    }
    if (l.site_web) h += '<a href="' + echapper(lienWeb(l.site_web)) + '" target="_blank" rel="noopener">🌐 Site web</a>';
    h += '</div><p class="tip">💬 Les infos peuvent changer : n\'hésitez pas à appeler avant de venir.</p></details></li>';
    return h;
  }

  function afficher() {
    var res = lieuxFiltres();
    var n = res.length;
    $('results-title').textContent = state.origine ? 'Les lieux les plus proches' : 'Lieux de bénévolat';
    $('results-count').textContent = n === 0 ? '' :
      n + (n > 1 ? ' lieux trouvés' : ' lieu trouvé') + (state.origine ? ', du plus proche au plus loin.' : '.');
    $('list').innerHTML = n ? res.map(carteHTML).join('') :
      '<li class="empty">Aucun lieu ne correspond à ces choix. Essayez d\'enlever un filtre.</li>';
    if (state.vue === 'map') majCarte(res);
  }

  // ---------- Carte ----------

  function majCarte(res) {
    if (typeof L === 'undefined') return;
    if (!carte) {
      carte = L.map('map', { scrollWheelZoom: false }).setView([50.45, 4.0], 9);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      }).addTo(carte);
      calqueMarqueurs = L.layerGroup().addTo(carte);
    }
    carte.invalidateSize();
    calqueMarqueurs.clearLayers();
    var points = [];
    res.forEach(function (l) {
      if (!l.position) return;
      var m = L.marker([l.position.lat, l.position.lng]).addTo(calqueMarqueurs);
      var div = document.createElement('div');
      div.innerHTML = '<strong>' + echapper(l.nom) + '</strong><br>' + echapper(l.commune) +
        (l.distance != null ? ' – ' + formatDistance(l.distance) : '') + '<br>';
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Voir la fiche';
      b.addEventListener('click', function () { montrerFiche(l.id); });
      div.appendChild(b);
      m.bindPopup(div);
      points.push([l.position.lat, l.position.lng]);
    });
    if (state.origine) {
      L.circleMarker([state.origine.lat, state.origine.lng], {
        radius: 9, color: '#c8702e', fillColor: '#c8702e', fillOpacity: .9
      }).bindTooltip('Vous êtes ici').addTo(calqueMarqueurs);
      points.push([state.origine.lat, state.origine.lng]);
    }
    if (points.length) carte.fitBounds(points, { padding: [30, 30], maxZoom: 13 });
  }

  function changerVue(vue) {
    state.vue = vue;
    document.querySelectorAll('.view-toggle button').forEach(function (b) {
      var actif = b.getAttribute('data-view') === vue;
      b.classList.toggle('active', actif);
      b.setAttribute('aria-pressed', String(actif));
    });
    $('map').hidden = vue !== 'map';
    $('list').hidden = vue !== 'list';
    if (vue === 'map') majCarte(lieuxFiltres());
  }

  function montrerFiche(id) {
    changerVue('list');
    var el = $(id);
    if (!el) return;
    el.querySelector('details').open = true;
    el.classList.add('highlight');
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(function () { el.classList.remove('highlight'); }, 2500);
  }

  // ---------- Recherche d'adresse ----------

  function statut(texte, erreur) {
    var s = $('search-status');
    s.textContent = texte;
    s.classList.toggle('error', !!erreur);
  }

  function definirOrigine(pos, libelle) {
    state.origine = pos;
    statut(libelle ? '✔ Recherche autour de : ' + libelle : '');
    afficher();
    $('results-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function chercherAdresse(texte) {
    texte = texte.trim();
    if (!texte) { statut('Écrivez votre commune ou votre adresse.', true); return; }
    statut('Recherche en cours…');
    var q = /^\d{4}$/.test(texte) ? texte + ', Belgique' : texte;
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=be' +
      '&accept-language=fr&viewbox=2.8,50.85,4.9,49.9&q=' + encodeURIComponent(q);
    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (res) {
        if (!res.length) {
          statut('Nous n\'avons pas trouvé cette adresse. Essayez simplement le nom de votre commune.', true);
          return;
        }
        var nom = res[0].display_name.split(',').slice(0, 3).join(',');
        definirOrigine({ lat: parseFloat(res[0].lat), lng: parseFloat(res[0].lon) }, nom);
      })
      .catch(function () {
        statut('La recherche ne fonctionne pas pour le moment. Réessayez dans un instant.', true);
      });
  }

  function localiser() {
    if (!navigator.geolocation) { statut('Votre appareil ne permet pas de vous localiser. Écrivez votre commune.', true); return; }
    statut('Localisation en cours…');
    navigator.geolocation.getCurrentPosition(function (p) {
      definirOrigine({ lat: p.coords.latitude, lng: p.coords.longitude }, 'votre position actuelle');
    }, function () {
      statut('Impossible de vous localiser. Écrivez plutôt votre commune.', true);
    }, { timeout: 10000, maximumAge: 60000 });
  }

  // ---------- Démarrage ----------

  $('search-form').addEventListener('submit', function (e) {
    e.preventDefault();
    chercherAdresse($('address').value);
  });
  $('locate').addEventListener('click', localiser);
  ['f-douceur', 'f-accueil', 'f-pmr'].forEach(function (id) { $(id).addEventListener('change', afficher); });
  $('reset-filters').addEventListener('click', function () {
    state.categories.clear();
    document.querySelectorAll('#category-filters .chip').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    ['f-douceur', 'f-accueil', 'f-pmr'].forEach(function (id) { $(id).checked = false; });
    afficher();
  });
  document.querySelectorAll('.view-toggle button').forEach(function (b) {
    b.addEventListener('click', function () { changerVue(b.getAttribute('data-view')); });
  });

  charger();
})();
