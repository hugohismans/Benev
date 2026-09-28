#!/usr/bin/env python3
"""Importe des lieux en masse dans _data/lieux/.

Usage : python3 scripts/importer.py fichier1.json [fichier2.json ...]

Chaque fichier contient une liste de lieux (mêmes champs que dans l'admin).
Les coordonnées GPS manquantes sont calculées avec OpenStreetMap (Nominatim),
à raison d'une requête par seconde. Les lieux dont le fichier existe déjà
ne sont pas écrasés.
"""
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

DOSSIER = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '_data', 'lieux')
# Hainaut, avec un peu de marge
LAT_MIN, LAT_MAX, LNG_MIN, LNG_MAX = 49.9, 50.85, 2.8, 4.9
CHAMPS = ['nom', 'actif', 'description', 'categories', 'adresse', 'code_postal', 'commune',
          'coordonnees', 'telephone', 'email', 'site_web', 'horaires', 'engagement',
          'engagement_details', 'debut_en_douceur', 'accueil_adapte', 'personne_reference',
          'pmr', 'transports', 'source', 'notes']


def slug(texte):
    texte = unicodedata.normalize('NFD', texte).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', texte.lower()).strip('-')[:80]


def nominatim(params):
    params = dict(params, format='jsonv2', limit=1, countrycodes='be')
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': 'benev-importer/1.0 (site de bénévolat, Hainaut)'})
    time.sleep(1.1)
    with urllib.request.urlopen(req, timeout=20) as r:
        res = json.load(r)
    if not res:
        return None
    lat, lng = float(res[0]['lat']), float(res[0]['lon'])
    if not (LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX):
        return None
    return lat, lng


def geocoder(lieu):
    """Renvoie ((lat, lng), précision) ou (None, None)."""
    rue, cp, commune = lieu.get('adresse', ''), lieu.get('code_postal', ''), lieu.get('commune', '')
    essais = []
    if rue:
        essais.append(({'street': rue, 'postalcode': cp, 'city': commune}, 'adresse'))
        essais.append(({'q': ', '.join(x for x in [rue, cp, commune] if x)}, 'adresse'))
    if cp or commune:
        essais.append(({'q': ', '.join(x for x in [cp, commune, 'Belgique'] if x)}, 'commune'))
    for params, precision in essais:
        params = {k: v for k, v in params.items() if v}
        try:
            pos = nominatim(params)
        except Exception as e:  # réseau, quota…
            print('  ! erreur Nominatim :', e)
            pos = None
        if pos:
            return pos, precision
    return None, None


def main(fichiers):
    os.makedirs(DOSSIER, exist_ok=True)
    existants = {f[:-5] for f in os.listdir(DOSSIER) if f.endswith('.json')}
    ajoutes = ignores = 0
    for chemin in fichiers:
        with open(chemin, encoding='utf-8') as f:
            lieux = json.load(f)
        for lieu in lieux:
            nom = (lieu.get('nom') or '').strip()
            if not nom or not lieu.get('commune'):
                print('- ignoré (nom ou commune manquant) :', nom or lieu)
                ignores += 1
                continue
            nom_fichier = slug(nom + ' ' + lieu['commune'] if slug(lieu['commune']) not in slug(nom) else nom)
            if nom_fichier in existants:
                print('- déjà présent :', nom)
                ignores += 1
                continue
            notes = [lieu.get('notes', '').strip()] if lieu.get('notes') else []
            if not lieu.get('coordonnees'):
                pos, precision = geocoder(lieu)
                if not pos:
                    print('- ignoré (adresse introuvable) :', nom)
                    ignores += 1
                    continue
                lieu['coordonnees'] = '%.5f, %.5f' % pos
                if precision == 'commune':
                    notes.append('Coordonnées approximatives (centre de la commune) : à corriger.')
            lieu['notes'] = ' '.join(notes)
            lieu['actif'] = lieu.get('actif', True)
            propre = {}
            for champ in CHAMPS:
                valeur = lieu.get(champ)
                if valeur is None or valeur == '' or valeur == []:
                    continue
                propre[champ] = valeur
            with open(os.path.join(DOSSIER, nom_fichier + '.json'), 'w', encoding='utf-8') as f:
                json.dump(propre, f, ensure_ascii=False, indent=2)
                f.write('\n')
            existants.add(nom_fichier)
            ajoutes += 1
            print('+', nom, '→', lieu['coordonnees'])
    print('\n%d lieux ajoutés, %d ignorés.' % (ajoutes, ignores))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1:])
