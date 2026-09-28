#!/usr/bin/env python3
"""Importe des lieux en masse dans _data/lieux/.

Usage : python3 scripts/importer.py fichier1.json [fichier2.json ...]
        python3 scripts/importer.py --corriger   (recalcule les coordonnées approximatives)

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
import urllib.error
import urllib.parse
import urllib.request

DOSSIER = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '_data', 'lieux')
# Hainaut et régions voisines (Brabant wallon, Namur, bordure flamande et française)
LAT_MIN, LAT_MAX, LNG_MIN, LNG_MAX = 49.8, 51.0, 2.5, 5.6
CHAMPS = ['nom', 'actif', 'description', 'categories', 'adresse', 'code_postal', 'commune',
          'coordonnees', 'telephone', 'email', 'site_web', 'horaires', 'engagement',
          'engagement_details', 'debut_en_douceur', 'accueil_adapte', 'personne_reference',
          'pmr', 'langue', 'transports', 'source', 'notes']


NOTE_APPROX = 'Coordonnées approximatives (centre de la commune) : à corriger.'


def slug(texte):
    texte = texte.replace('œ', 'oe').replace('Œ', 'Oe').replace('æ', 'ae')
    texte = unicodedata.normalize('NFD', texte).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', texte.lower()).strip('-')[:80]


def nominatim(params):
    params = dict(params, format='jsonv2', limit=1, countrycodes='be,fr')
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': 'benev-importer/1.0 (site de bénévolat, Hainaut)'})
    for essai in range(3):
        time.sleep(1.5)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                res = json.load(r)
            break
        except urllib.error.HTTPError as e:
            if e.code != 429 or essai == 2:
                raise
            print('  (trop de requêtes, pause de 60 s)')
            time.sleep(60)
    if not res:
        return None
    lat, lng = float(res[0]['lat']), float(res[0]['lon'])
    if not (LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX):
        return None
    return lat, lng


def cle_adresse(lieu):
    """Clé servant à repérer deux fiches pour une même adresse."""
    rue = slug(lieu.get('adresse', ''))
    if not rue or not re.search(r'\d', rue):
        return None
    return rue + '|' + (lieu.get('code_postal') or slug(lieu.get('commune', '')))


def geocoder(lieu):
    """Renvoie ((lat, lng), précision) ou (None, None)."""
    rue, cp = lieu.get('adresse', ''), lieu.get('code_postal', '')
    # « Gilly (Charleroi) » → « Gilly » ; « Renaix (Ronse) » → « Renaix », puis « Ronse »
    brut = lieu.get('commune', '')
    commune = re.sub(r'\s*\(.*?\)', '', brut).strip()
    entre = re.findall(r'\((.*?)\)', brut)
    communes = [commune] + [c for c in entre if c != 'France']
    pays = 'France' if 'France' in entre or cp.startswith('59') and len(cp) == 5 else 'Belgique'
    essais = []
    rues = [rue] if rue else []
    # « Maison du Peuple, Place Émile Vandervelde 28 » → « Place Émile Vandervelde 28 »
    morceaux = [m.strip() for m in rue.split(',') if re.search(r'\d', m)]
    if morceaux and morceaux[-1] != rue:
        rues.append(morceaux[-1])
    for r in rues:
        for c in communes:
            essais.append(({'street': r, 'postalcode': cp, 'city': c}, 'adresse'))
            essais.append(({'q': ', '.join(x for x in [r, cp, c, pays] if x)}, 'adresse'))
    if cp or commune:
        for c in communes:
            essais.append(({'q': ', '.join(x for x in [cp, c, pays] if x)}, 'commune'))
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
    adresses = set()
    for f in existants:
        with open(os.path.join(DOSSIER, f + '.json'), encoding='utf-8') as fh:
            cle = cle_adresse(json.load(fh))
        if cle:
            adresses.add(cle)
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
            cle = cle_adresse(lieu)
            if cle and cle in adresses:
                print('- doublon (même adresse) :', nom)
                ignores += 1
                continue
            notes = [lieu.get('notes', '').strip()] if lieu.get('notes') else []
            # Un lieu dont le bénévolat n'est pas confirmé est importé mais caché.
            if lieu.get('benevolat_confirme') is False:
                lieu['actif'] = False
                notes.insert(0, 'À VÉRIFIER : accueil de bénévoles non confirmé.')
            if not lieu.get('coordonnees'):
                pos, precision = geocoder(lieu)
                if not pos:
                    print('- ignoré (adresse introuvable) :', nom)
                    ignores += 1
                    continue
                lieu['coordonnees'] = '%.5f, %.5f' % pos
                if precision == 'commune':
                    notes.append(NOTE_APPROX)
            if 'accueil_francophone' in lieu and not lieu.get('langue'):
                lieu['langue'] = {True: 'Néerlandais, francophones bienvenus',
                                  False: 'Néerlandais'}.get(lieu['accueil_francophone'],
                                                            'Néerlandais (à vérifier)')
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
            if cle:
                adresses.add(cle)
            ajoutes += 1
            print('+', nom, '→', lieu['coordonnees'])
    print('\n%d lieux ajoutés, %d ignorés.' % (ajoutes, ignores))


def corriger():
    for f in sorted(os.listdir(DOSSIER)):
        chemin = os.path.join(DOSSIER, f)
        with open(chemin, encoding='utf-8') as fh:
            lieu = json.load(fh)
        if NOTE_APPROX not in lieu.get('notes', ''):
            continue
        pos, precision = geocoder(lieu)
        if precision != 'adresse':
            print('- toujours approximatif :', lieu['nom'])
            continue
        lieu['coordonnees'] = '%.5f, %.5f' % pos
        lieu['notes'] = ' '.join(lieu['notes'].replace(NOTE_APPROX, '').split())
        if not lieu['notes']:
            del lieu['notes']
        with open(chemin, 'w', encoding='utf-8') as fh:
            json.dump(lieu, fh, ensure_ascii=False, indent=2)
            fh.write('\n')
        print('+ corrigé :', lieu['nom'], '→', lieu['coordonnees'])


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    if sys.argv[1] == '--corriger':
        corriger()
    else:
        main(sys.argv[1:])
