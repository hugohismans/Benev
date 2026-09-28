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

  // Page courante : « accueil » (recherche) ou « imprimer » (page d'impression).
  var PAGE = document.body.getAttribute('data-page') || 'accueil';

  var state = {
    lieux: [],
    origine: null,       // { lat, lng, texte } : jamais enregistré ni envoyé à notre serveur
    categories: new Set(),
    vue: 'list',
    limite: 20,        // nombre de lieux affichés dans la liste
    criteres: null     // filtres transmis à la page d'impression
  };
  var PAR_PAGE = 20;
  var carte = null;
  var calqueMarqueurs = null;
  var calqueOrigine = null;

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

  // Itinéraire Google Maps en transports en commun. Le départ est l'adresse
  // tapée par la personne ; sans elle (géolocalisation), Google part de sa position.
  function lienItineraire(l, adresse) {
    var approx = /approximatives/.test(l.notes || '');
    var arrivee = (approx && adresse) ? adresse : l.position.lat + ',' + l.position.lng;
    var url = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(arrivee) + '&travelmode=transit';
    if (state.origine && state.origine.texte) url += '&origin=' + encodeURIComponent(state.origine.texte);
    return url;
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
        if (PAGE === 'imprimer') {
          majApercu();
        } else {
          construireFiltres();
          afficher();
        }
      })
      .catch(function () {
        var msg = 'Désolé, la liste des lieux n\'a pas pu être chargée. Réessayez dans quelques instants.';
        if (PAGE === 'imprimer') $('print-area').textContent = msg;
        else $('list').innerHTML = '<li class="empty">' + msg + '</li>';
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
      b.setAttribute('aria-pressed', String(state.categories.has(c)));
      b.textContent = icone(c) + ' ' + c;
      b.addEventListener('click', function () {
        if (state.categories.has(c)) state.categories.delete(c); else state.categories.add(c);
        b.setAttribute('aria-pressed', String(state.categories.has(c)));
        afficher();
      });
      conteneur.appendChild(b);
    });
  }

  // Filtres en cours : lus dans la page de recherche, ou transmis à la page d'impression.
  function criteres() {
    if (state.criteres) return state.criteres;
    return {
      categories: state.categories,
      douceur: $('f-douceur').checked,
      accueil: $('f-accueil').checked,
      pmr: $('f-pmr').checked
    };
  }

  function lieuxFiltres() {
    var c = criteres();
    var res = state.lieux.filter(function (l) {
      if (c.categories.size && !l.categories.some(function (x) { return c.categories.has(x); })) return false;
      if (c.douceur && !l.debut_en_douceur) return false;
      if (c.accueil && !l.accueil_adapte) return false;
      if (c.pmr && l.pmr !== 'Oui') return false;
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
    if (l.langue) badges.push('🗣️ ' + echapper(l.langue));
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
    if (l.position) h += '<a href="' + echapper(lienItineraire(l, adresse)) + '" target="_blank" rel="noopener">🚌 Itinéraire en bus/train</a>';
    if (l.site_web) h += '<a href="' + echapper(lienWeb(l.site_web)) + '" target="_blank" rel="noopener">🌐 Site web</a>';
    h += '</div><p class="tip">💬 Les infos peuvent changer : n\'hésitez pas à appeler avant de venir.</p></details></li>';
    return h;
  }

  function afficher(garderLimite) {
    if (!garderLimite) state.limite = PAR_PAGE;
    var res = lieuxFiltres();
    var n = res.length;
    $('results-title').textContent = state.origine ? 'Les lieux les plus proches' : 'Lieux de bénévolat';
    $('results-count').textContent = n === 0 ? '' :
      n + (n > 1 ? ' lieux trouvés' : ' lieu trouvé') + (state.origine ? ', du plus proche au plus loin.' : '.');
    $('list').innerHTML = n ? res.slice(0, state.limite).map(carteHTML).join('') :
      '<li class="empty">Aucun lieu ne correspond à ces choix. Essayez d\'enlever un filtre.</li>';
    var plus = $('more');
    plus.hidden = state.vue !== 'list' || n <= state.limite;
    plus.textContent = 'Voir plus de lieux (' + (n - Math.min(n, state.limite)) + ' autres)';
    if (state.vue === 'map') majCarte(res);
    majLienImpression();
  }

  // Le lien « Imprimer » emporte l'adresse et les filtres après le « # » :
  // cette partie de l'adresse n'est jamais envoyée au serveur.
  function majLienImpression() {
    var c = criteres(), p = new URLSearchParams();
    if (state.origine) {
      p.set('lat', state.origine.lat.toFixed(5));
      p.set('lng', state.origine.lng.toFixed(5));
      if (state.origine.texte) p.set('q', state.origine.texte);
      if (state.origineLibelle) p.set('lib', state.origineLibelle);
    }
    if (c.categories.size) p.set('cat', Array.from(c.categories).join('|'));
    if (c.douceur) p.set('d', '1');
    if (c.accueil) p.set('a', '1');
    if (c.pmr) p.set('p', '1');
    var h = p.toString();
    $('print-link').href = 'imprimer.html' + (h ? '#' + h : '');
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
      // Regroupe les lieux proches en bulles numérotées (si le module est chargé).
      calqueMarqueurs = (L.markerClusterGroup ?
        L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45 }) : L.layerGroup()).addTo(carte);
      calqueOrigine = L.layerGroup().addTo(carte);
    }
    carte.invalidateSize();
    calqueMarqueurs.clearLayers();
    calqueOrigine.clearLayers();
    var points = [];
    res.forEach(function (l) {
      if (!l.position) return;
      var m = L.marker([l.position.lat, l.position.lng]);
      calqueMarqueurs.addLayer(m);
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
      }).bindTooltip('Vous êtes ici').addTo(calqueOrigine);
      // Zoom sur la personne et les 8 lieux les plus proches (la liste est déjà triée).
      points = res.filter(function (l) { return l.position; }).slice(0, 8)
        .map(function (l) { return [l.position.lat, l.position.lng]; });
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
    afficher(true);
  }

  function montrerFiche(id) {
    state.vue = 'list';
    state.limite = Infinity;
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
    state.origineLibelle = libelle;
    statut(libelle ? '✔ Recherche autour de : ' + libelle : '');
    if (PAGE === 'imprimer') {
      $('print-proches').checked = true;
      majApercu();
      return;
    }
    afficher();
    $('results-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function chercherAdresse(texte) {
    texte = texte.trim();
    if (!texte) { statut('Écrivez votre commune ou votre adresse.', true); return; }
    statut('Recherche en cours…');
    var q = /^\d{4}$/.test(texte) ? texte + ', Belgique' : texte;
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=be,fr' +
      '&accept-language=fr&viewbox=2.8,50.85,4.9,49.9&bounded=0&q=' + encodeURIComponent(q);
    fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (res) {
        if (!res.length) {
          statut('Nous n\'avons pas trouvé cette adresse. Essayez simplement le nom de votre commune.', true);
          return;
        }
        var nom = res[0].display_name.split(',').slice(0, 3).join(',');
        definirOrigine({ lat: parseFloat(res[0].lat), lng: parseFloat(res[0].lon), texte: q }, nom);
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

  // ---------- Impression ----------

  function ligne(label, valeur) {
    return valeur ? '<dt>' + label + '</dt><dd>' + echapper(valeur) + '</dd>' : '';
  }

  function adresseComplete(l) {
    return [l.adresse, [l.code_postal, l.commune].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  }

  function descriptionFiltres() {
    var c = criteres(), f = Array.from(c.categories);
    if (c.douceur) f.push('début en douceur');
    if (c.accueil) f.push('accueil des personnes fragilisées');
    if (c.pmr) f.push('accessible en fauteuil roulant');
    return f.join(', ');
  }

  // Région d'un lieu, d'après son code postal (pour l'impression du répertoire).
  var REGIONS = ['Hainaut', 'Province de Namur', 'Brabant wallon', 'France (bordure)', 'Flandre (bordure)'];
  function region(l) {
    var cp = parseInt(l.code_postal, 10) || 0;
    if (/\(France\)/.test(l.commune || '') || cp >= 10000) return 'France (bordure)';
    if (cp >= 1300 && cp <= 1499) return 'Brabant wallon';
    if (cp >= 5000 && cp <= 5680) return 'Province de Namur';
    if ((cp >= 6000 && cp <= 6599) || (cp >= 7000 && cp <= 7999) || !cp) return 'Hainaut';
    return 'Flandre (bordure)';
  }

  function lieuxAImprimer(quoi, nombre) {
    if (quoi === 'proches') {
      return lieuxFiltres().filter(function (l) { return l.distance != null; }).slice(0, nombre);
    }
    if (quoi === 'filtres') return lieuxFiltres();
    // Tout le répertoire, classé par commune (avec la distance si une adresse est connue).
    return state.lieux.slice().map(function (l) {
      l.distance = (state.origine && l.position) ? distanceKm(state.origine, l.position) : null;
      return l;
    }).sort(function (a, b) {
      return REGIONS.indexOf(region(a)) - REGIONS.indexOf(region(b)) ||
        (a.commune || '').localeCompare(b.commune || '', 'fr') || a.nom.localeCompare(b.nom, 'fr');
    });
  }

  function resumeHTML(liste) {
    var h = '<table><colgroup><col class="c-lieu"><col class="c-ou"><col class="c-tel"><col class="c-quand"></colgroup>' +
      '<thead><tr><th>Lieu</th><th>Où</th><th>Téléphone</th><th>Quand</th></tr></thead><tbody>';
    liste.forEach(function (l) {
      h += '<tr><td><strong>' + echapper(l.nom) + '</strong><br><span class="p-cat">' +
        echapper(l.categories.join(', ')) + '</span></td>';
      h += '<td>' + echapper(l.commune) + (l.distance != null ? '<br>' + formatDistance(l.distance) : '') + '</td>';
      h += l.telephone ? '<td class="p-tel">' + echapper(l.telephone) + '</td>' :
        '<td class="p-mail">' + echapper(l.email || '') + '</td>';
      h += '<td>' + echapper(l.horaires || '') + '</td></tr>';
    });
    return h + '</tbody></table>';
  }

  function ficheHTML(l) {
    var h = '<div class="p-fiche"><h3>' + echapper(l.nom) + '</h3>';
    h += '<p class="p-lieu">' + echapper(l.commune) + (l.distance != null ? ' – ' + formatDistance(l.distance) : '') +
      (l.categories.length ? ' · ' + echapper(l.categories.join(', ')) : '') + '</p>';
    if (l.description) h += '<p>' + echapper(l.description) + '</p>';
    var plus = [];
    if (l.debut_en_douceur) plus.push('possible de commencer en douceur');
    if (l.accueil_adapte) plus.push('habitué à accueillir des personnes fragilisées');
    if (l.pmr === 'Oui') plus.push('accessible en fauteuil roulant');
    var engagement = l.engagement ? (ENGAGEMENT[l.engagement] || l.engagement) + (l.engagement_details ? ' – ' + l.engagement_details : '') : '';
    h += '<dl>' + ligne('Adresse', adresseComplete(l)) + ligne('Quand', l.horaires) + ligne('Engagement', engagement) +
      ligne('Qui demander', l.personne_reference) + ligne('Téléphone', l.telephone) + ligne('E-mail', l.email) +
      ligne('Site web', l.site_web) + ligne('Bus / train', l.transports) + ligne('Langue', l.langue) +
      ligne('À savoir', plus.join(', ')) + '</dl></div>';
    return h;
  }

  function rendreImpression(quoi, format, nombre, avecAide) {
    var liste = lieuxAImprimer(quoi, nombre);
    var titres = {
      proches: 'Les ' + liste.length + ' lieux de bénévolat les plus proches',
      filtres: 'Lieux de bénévolat (' + liste.length + ')',
      tout: 'Répertoire des lieux de bénévolat (' + liste.length + ')'
    };
    var meta = [];
    if (state.origine && state.origineLibelle) meta.push('Autour de : ' + state.origineLibelle);
    var filtres = descriptionFiltres();
    if (filtres && quoi !== 'tout') meta.push('Choix : ' + filtres);
    meta.push('Imprimé le ' + new Date().toLocaleDateString('fr-BE'));

    var h = '<h1>' + echapper(titres[quoi]) + '</h1><p class="p-meta">' + echapper(meta.join(' · ')) + '</p>';
    var rendu = format === 'resume' ? resumeHTML : function (ls) { return ls.map(ficheHTML).join(''); };
    if (quoi === 'tout') {
      // Un titre par région, les lieux triés par commune à l'intérieur
      REGIONS.forEach(function (r) {
        var lieux = liste.filter(function (l) { return region(l) === r; });
        if (lieux.length) h += '<h2>' + echapper(r) + ' (' + lieux.length + ')</h2>' + rendu(lieux);
      });
    } else {
      h += rendu(liste);
    }
    h += '<div class="p-pied"><p>Les informations peuvent changer : appelez le lieu avant de vous y rendre. ' +
      'Liste complète et à jour : ' + echapper(location.origin + location.pathname.replace(/imprimer\.html$/, '')) + '</p>';
    if (avecAide) {
      h += '<p><strong>Besoin de parler ?</strong> Lignes gratuites et anonymes :</p><ul>' +
        '<li>Centre de Prévention du Suicide : 0800 32 123 (24 h/24)</li>' +
        '<li>Télé-Accueil : 107 (24 h/24)</li><li>Urgence : 112</li></ul>';
    }
    h += '</div>';
    $('print-area').innerHTML = h;
  }

  function choix(nom) {
    var el = document.querySelector('input[name="' + nom + '"]:checked');
    return el ? el.value : null;
  }

  // Page d'impression : met à jour les explications et l'aperçu.
  function majApercu() {
    var proches = $('print-proches');
    proches.disabled = !state.origine;
    if (!state.origine && proches.checked) document.querySelector('input[value="filtres"]').checked = true;
    $('print-origine').textContent = state.origine ?
      '📍 ' + (state.origineLibelle || state.origine.texte || 'votre adresse') :
      'Aucune adresse : indiquez-en une pour classer les lieux du plus proche au plus loin.';
    $('print-proches-aide').textContent = state.origine ? '' : 'Indiquez d\'abord une adresse ci-dessus.';
    var f = descriptionFiltres();
    $('print-filtres-aide').textContent = lieuxFiltres().length + ' lieux' + (f ? ', avec vos choix : ' + f : '') + '.';
    $('print-tout-aide').textContent = state.lieux.length + ' lieux, sans filtre.';
    rendreImpression(choix('quoi'), choix('format'), parseInt($('print-nombre').value, 10), $('print-aide').checked);
  }

  // Lit l'adresse et les filtres transmis après le « # » (entre les deux pages).
  function lireHash() {
    var p = new URLSearchParams(location.hash.slice(1));
    var lat = parseFloat(p.get('lat')), lng = parseFloat(p.get('lng'));
    if (!isNaN(lat) && !isNaN(lng)) {
      state.origine = { lat: lat, lng: lng, texte: p.get('q') || '' };
      state.origineLibelle = p.get('lib') || p.get('q') || '';
    }
    return {
      categories: new Set((p.get('cat') || '').split('|').filter(Boolean)),
      douceur: p.get('d') === '1',
      accueil: p.get('a') === '1',
      pmr: p.get('p') === '1'
    };
  }

  function initImpression() {
    state.criteres = lireHash();
    // Choix par défaut : les 10 plus proches en détaillé, sinon la recherche en résumé.
    document.querySelector('input[name="quoi"][value="' + (state.origine ? 'proches' : 'filtres') + '"]').checked = true;
    document.querySelector('input[name="format"][value="' + (state.origine ? 'detail' : 'resume') + '"]').checked = true;

    document.querySelectorAll('.print-options input, .print-options select').forEach(function (el) {
      if (el.id !== 'address') el.addEventListener('change', majApercu);
    });
    $('print-nombre').addEventListener('change', function () {
      if (state.origine) $('print-proches').checked = true;
      majApercu();
    });
    $('search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      chercherAdresse($('address').value);
    });
    $('print-go').addEventListener('click', function () { window.print(); });
    // « Retour » rouvre la recherche avec la même adresse et les mêmes filtres.
    $('retour').href = './' + location.hash;
    charger();
  }

  // ---------- Démarrage ----------

  function initAccueil() {
    var c = lireHash();
    state.categories = c.categories;
    $('f-douceur').checked = c.douceur;
    $('f-accueil').checked = c.accueil;
    $('f-pmr').checked = c.pmr;
    if (state.origine) {
      statut('✔ Recherche autour de : ' + state.origineLibelle);
      if (state.origine.texte) $('address').value = state.origine.texte;
    }
    if (c.categories.size || c.douceur || c.accueil || c.pmr) $('filters-panel').open = true;
    $('search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      chercherAdresse($('address').value);
    });
    $('locate').addEventListener('click', localiser);
    ['f-douceur', 'f-accueil', 'f-pmr'].forEach(function (id) { $(id).addEventListener('change', function () { afficher(); }); });
    $('reset-filters').addEventListener('click', function () {
      state.categories.clear();
      document.querySelectorAll('#category-filters .chip').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
      ['f-douceur', 'f-accueil', 'f-pmr'].forEach(function (id) { $(id).checked = false; });
      afficher();
    });
    document.querySelectorAll('.view-toggle button').forEach(function (b) {
      b.addEventListener('click', function () { changerVue(b.getAttribute('data-view')); });
    });

    $('more').addEventListener('click', function () {
      state.limite += PAR_PAGE;
      afficher(true);
    });

    charger();
  }

  if (PAGE === 'imprimer') initImpression(); else initAccueil();
})();
