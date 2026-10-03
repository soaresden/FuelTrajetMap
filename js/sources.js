/*
 * FuelMap — sources de prix des pays voisins, converties au format interne de l'appli.
 * Partagé entre le navigateur (window.FuelSources) et tools/build-data.mjs (Node).
 *   es Espagne  : Ministerio, API REST officielle            — CORS ouvert, mise à jour ~30 min
 *   pt Portugal : DGEG precoscombustiveis.dgeg.gov.pt        — CORS ouvert, usage non commercial
 *   ad Andorre  : Govern d'Andorra (service ArcGIS public)   — CORS ouvert
 *   it Italie   : MIMIT open data, licence IODL 2.0          — PAS de CORS : seulement via data/it.json (GitHub Action)
 * Belgique, Suisse, Luxembourg : aucune donnée ouverte par station. Allemagne : clé API personnelle obligatoire.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FuelSources = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var FUELS = ['gazole', 'sp95', 'e10', 'sp98', 'e85', 'gplc'], DAY = 86400000;
  function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(',', '.').replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : 0; }
  function okPrice(p) { return p > 0.3 && p < 5 ? +p.toFixed(3) : 0; }
  function day(ms) { return isFinite(ms) ? Math.floor(ms / DAY) : 0; }
  // Enseignes : les sources écrivent la même marque de dix façons (« Total », « TOTAL ACCESS », « Total Energies »…)
  var BRANDS = [[/total|^elf\b/i, 'TotalEnergies'], [/leclerc/i, 'E.Leclerc'], [/intermarch|mousquetaires/i, 'Intermarché'], [/carrefour/i, 'Carrefour'],
    [/(super|hyper|march[eé]|station|syst[eè]me)\s*u\b|^u(\s+express)?$|^la station u/i, 'Système U'], [/auchan/i, 'Auchan'], [/esso/i, 'Esso'], [/^avia\b/i, 'Avia'], [/^bp\b/i, 'BP'],
    [/shell/i, 'Shell'], [/^eni\b|agip/i, 'Eni'], [/casino|g[eé]ant/i, 'Casino'], [/netto/i, 'Netto'], [/dyneff/i, 'Dyneff'], [/repsol|campsa|petronor/i, 'Repsol'], [/cepsa|moeve/i, 'Cepsa'],
    [/galp/i, 'Galp'], [/^q8|kuwait/i, 'Q8'], [/tamoil/i, 'Tamoil'], [/^ip\b|italiana petroli|api-ip/i, 'IP'], [/ballenoil/i, 'Ballenoil'], [/plenoil|plenergy/i, 'Plenergy'], [/petroprix/i, 'Petroprix'],
    [/alcampo/i, 'Alcampo'], [/eroski/i, 'Eroski'], [/prio\b/i, 'Prio'], [/^cora\b/i, 'Cora'], [/^vito\b/i, 'Vito'], [/^elan\b/i, 'Elan']];
  function normBrand(raw) {
    raw = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!raw || /^(independent|ind[eé]pendant|sans|pompe bianche|pompebianche|n[ºo°]\s*[\d.]+)$/i.test(raw) || /^n[ºo°]\s*[\d.]+$/i.test(raw)) return '';
    for (var i = 0; i < BRANDS.length; i++) if (BRANDS[i][0].test(raw)) return BRANDS[i][1];
    return raw.length > 22 ? '' : raw.toLowerCase().replace(/(^|[\s\-.'])([a-zà-ÿ])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }
  function station(cc, id, lat, lon, o) {
    return { id: cc + id, cc: cc, lat: +(+lat).toFixed(5), lon: +(+lon).toFixed(5), cp: o.cp || '', adr: o.adr || '', ville: o.ville || '', brand: normBrand(o.brand), a24: !!o.a24, hw: !!o.hw, p: [0, 0, 0, 0, 0, 0], m: [0, 0, 0, 0, 0, 0], r: 0 };
  }
  function setMin(s, fuel, price, d) { var i = FUELS.indexOf(fuel), p = okPrice(price); if (i < 0 || !p) return; if (s.p[i] && s.p[i] <= p) return; s.p[i] = p; s.m[i] = d; }
  function dmy(str) { var t = String(str || '').match(/\d+/g) || []; return day(Date.UTC(+t[2], +t[1] - 1, +t[0], +t[3] || 0, +t[4] || 0)); }
  function clean(list, min) { list = list.filter(function (s) { return s.lat && s.lon && (s.p.some(Boolean) || s.r); }); if (list.length < min) throw new Error('source incomplète (' + list.length + ' stations)'); return list; }

  var ES_FIELDS = { 'Precio Gasoleo A': 'gazole', 'Precio Gasolina 95 E5': 'sp95', 'Precio Gasolina 95 E10': 'e10', 'Precio Gasolina 98 E5': 'sp98', 'Precio Gasolina 95 E85': 'e85', 'Precio Bioetanol': 'e85', 'Precio Gases licuados del petróleo': 'gplc' };
  function parseES(j) {
    var when = dmy(j.Fecha);
    return clean((j.ListaEESSPrecio || []).map(function (r) {
      var s = station('es', r.IDEESS, num(r.Latitud), num(r['Longitud (WGS84)']), { cp: r['C.P.'], adr: r['Dirección'], ville: r.Localidad || r.Municipio, brand: r['Rótulo'], a24: /24\s*H/i.test(r.Horario || '') });
      for (var k in ES_FIELDS) setMin(s, ES_FIELDS[k], num(r[k]), when);
      return s;
    }), 500);
  }

  var PT_FUELS = { 'Gasóleo simples': 'gazole', 'Gasolina simples 95': 'sp95', 'Gasolina 98': 'sp98', 'Gasolina especial 98': 'sp98', 'GPL Auto': 'gplc' };
  function parsePT(j) {
    var byId = {}, out = [];
    (j.resultado || []).forEach(function (r) {
      var fuel = PT_FUELS[r.Combustivel]; if (!fuel) return;
      var s = byId[r.Id]; if (!s) { s = byId[r.Id] = station('pt', r.Id, +r.Latitude, +r.Longitude, { cp: r.CodPostal, adr: r.Morada, ville: r.Localidade || r.Municipio, brand: r.Marca || r.Nome, hw: /auto-?estrada/i.test(r.TipoPosto || '') }); out.push(s); }
      setMin(s, fuel, num(r.Preco), day(Date.parse(String(r.DataAtualizacao || '').replace(' ', 'T') + ':00Z')));
    });
    return clean(out, 500);
  }

  var AD_FUELS = { 6: 'gazole', 4: 'sp95', 5: 'sp98', 11: 'gplc' };
  function parseAD(j) {
    var byId = {}, out = [];
    (j.features || []).forEach(function (f) {
      var a = f.attributes, c = f.centroid, fuel = AD_FUELS[a.idProducte]; if (!fuel || !c) return;
      var s = byId[a.idIPE]; if (!s) { s = byId[a.idIPE] = station('ad', a.idIPE, c.y, c.x, { cp: 'AD', adr: a.NOM, ville: a.Parroquia, brand: a.Marca_importador }); out.push(s); }
      setMin(s, fuel, +a.PREU, day(Math.min(+a.DataInici || Date.now(), Date.now())));
    });
    return clean(out, 10);
  }

  var IT_PREMIUM = /(98|100|speciale|v[\s-]?power|perform|blue super|plus|energy)/i, IT_NOT_PETROL = /diesel|gasolio|hvo|metano|gnl|gnc|gpl/i;
  function parseIT(pricesCsv, registryCsv) {
    var byId = {}, out = [];
    registryCsv.split(/\r?\n/).slice(2).forEach(function (line) {
      var f = line.split('|'); if (f.length < 10) return;
      var n = f.length, lat = num(f[n - 2]), lon = num(f[n - 1]); // un « | » parasite existe parfois dans un champ texte : lat/lon = les 2 derniers
      if (!(lat > 35 && lat < 48 && lon > 6 && lon < 19)) return;
      out.push(byId[f[0]] = station('it', f[0], lat, lon, { brand: f[2], hw: /autostrad/i.test(f[3]), adr: String(f[5] || '').replace(/\s+/g, ' ').trim(), ville: f[n - 4], cp: f[n - 3] }));
    });
    pricesCsv.split(/\r?\n/).slice(2).forEach(function (line) {
      var f = line.split('|'), s = byId[f[0]], desc = f[1]; if (!s || !desc) return;
      var fuel = desc === 'Gasolio' ? 'gazole' : desc === 'Benzina' ? 'sp95' : desc === 'GPL' ? 'gplc' : IT_PREMIUM.test(desc) && !IT_NOT_PETROL.test(desc) ? 'sp98' : null;
      if (fuel) setMin(s, fuel, num(f[2]), dmy(f[4])); // servi + self-service : on garde le moins cher
    });
    return clean(out, 500);
  }

  // France : export complet du flux instantané (data.economie.gouv.fr)
  var FR_KEYS = ['gazole', 'sp95', 'e10', 'sp98', 'e85', 'gplc'];
  var FR_URL = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/exports/json?select=' +
    ['id', 'latitude', 'longitude', 'cp', 'pop', 'adresse', 'ville', 'horaires_automate_24_24', 'horaires_jour'].concat(FR_KEYS.map(function (k) { return k + '_prix'; }), FR_KEYS.map(function (k) { return k + '_maj'; }), FR_KEYS.map(function (k) { return k + '_rupture_type'; }), FR_KEYS.map(function (k) { return k + '_rupture_debut'; })).join(',');
  // Les heures de prix-carburants.gouv.fr sont en heure française ; l'API open data leur colle « +00:00 » à tort.
  // On garde donc les chiffres tels quels, interprétés dans le fuseau de l'appareil (celui des utilisateurs : la France).
  function localMs(iso) { return Date.parse(String(iso).slice(0, 19)); }
  // « Lundi07.00-21.00, Mardi07.00-12.00, 14.00-19.00, … » → 7 chaînes (lundi → dimanche) « 07:00-21:00|14:00-19:00 », '' = fermé ce jour-là
  var DAYS_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  function parseHours(str) {
    var out = ['', '', '', '', '', '', ''], cur = -1;
    String(str).split(',').forEach(function (part) {
      part = part.trim(); var m = /^([A-Za-zéû]+)\s*(.*)$/.exec(part), range;
      if (m && DAYS_FR.indexOf(m[1].toLowerCase()) >= 0) { cur = DAYS_FR.indexOf(m[1].toLowerCase()); range = m[2]; } else range = part;
      var r = /(\d{1,2})[.:h](\d{2})\s*-\s*(\d{1,2})[.:h](\d{2})/.exec(range || '');
      if (cur >= 0 && r) out[cur] += (out[cur] ? '|' : '') + r[1].padStart(2, '0') + ':' + r[2] + '-' + r[3].padStart(2, '0') + ':' + r[4];
    });
    return out.some(Boolean) ? out : null;
  }
  function parseFR(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], lat = +r.latitude / 1e5, lon = +r.longitude / 1e5;
      if (!(lat > 41 && lat < 51.5 && lon > -5.5 && lon < 10)) continue;
      var s = station('fr', '', lat, lon, { cp: r.cp, adr: r.adresse, ville: r.ville, a24: r.horaires_automate_24_24 === 'Oui', hw: r.pop === 'A' });
      s.id = r.id;
      if (r.horaires_jour) s.oh = parseHours(r.horaires_jour); // horaires d'ouverture par jour (lundi → dimanche)
      for (var f = 0; f < 6; f++) {
        var k = FR_KEYS[f], v = okPrice(+r[k + '_prix'] || 0), d = r[k + '_maj'], rt = r[k + '_rupture_type'];
        if (rt === 'definitive') continue;                                   // la station ne vend plus ce carburant : on ignore son ancien prix
        if (v) { s.p[f] = v; var ms = d ? localMs(d) : NaN; s.m[f] = day(ms); if (isFinite(ms)) (s.t = s.t || {})[f] = Math.floor(ms / 60000); } // t : minute de mise à jour (indice de confiance)
        if (rt === 'temporaire') { s.r |= (1 << f); var rd = r[k + '_rupture_debut']; if (rd) (s.rd = s.rd || {})[f] = day(localMs(rd)); } // rupture déclarée par le gérant
      }
      out.push(s);
    }
    return clean(out, 1000);
  }

  return {
    normBrand: normBrand,
    fr: { name: 'France', bbox: [41, -5.5, 51.5, 10], urls: [FR_URL], parse: parseFR, live: true, credit: 'prix-carburants.gouv.fr' },
    es: { name: 'Espagne', bbox: [35.9, -9.4, 43.9, 4.4], urls: ['https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/'], parse: parseES, live: true, credit: 'Ministerio para la Transición Ecológica (ES)' },
    pt: { name: 'Portugal', bbox: [36.9, -9.6, 42.2, -6.1], urls: ['https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PesquisarPostos?idsTiposComb=2101,3201,3400,3405,1120&idMarca=&idTipoPosto=&idDistrito=&idsMunicipios=&qtdPorPagina=50000&pagina=1'], parse: parsePT, live: true, credit: 'DGEG (PT)' },
    ad: { name: 'Andorre', bbox: [42.42, 1.40, 42.66, 1.79], urls: ['https://sig.govern.ad/server/rest/services/CARBURANTS/CARBURANTS/FeatureServer/1/query?where=1%3D1&outFields=*&returnGeometry=false&returnCentroid=true&outSR=4326&f=json'], parse: parseAD, live: true, credit: "Govern d'Andorra" },
    it: { name: 'Italie', bbox: [36.6, 6.6, 47.1, 18.6], urls: ['https://www.mimit.gov.it/images/exportCSV/prezzo_alle_8.csv', 'https://www.mimit.gov.it/images/exportCSV/anagrafica_impianti_attivi.csv'], parse: parseIT, live: false, text: true, credit: 'MIMIT (IT), IODL 2.0' }
  };
});
