/* Teintes constructeur courantes → couleur du curseur sur la carte (point de position, flèche du guidage).
 * Il n'existe pas de base ouverte des peintures d'usine avec leur rendu écran : cette table donne des valeurs APPROCHÉES
 * des teintes les plus vues sur les routes françaises. Si la sienne manque, le sélecteur de couleur libre prend le relais.
 * Format : [marque, nom de la teinte, couleur]. Recherche : FuelPaints.search('mazda deep crystal blue'). */
(function () {
  'use strict';
  var P = [
    ['Mazda', 'Soul Red Crystal', '#9b0f1c'], ['Mazda', 'Deep Crystal Blue', '#1c2b4b'], ['Mazda', 'Machine Gray', '#5f6365'], ['Mazda', 'Polymetal Gray', '#7d8487'],
    ['Mazda', 'Snowflake White Pearl', '#f2f1ec'], ['Mazda', 'Jet Black', '#0c0c0e'], ['Mazda', 'Zircon Sand', '#b7ad99'], ['Mazda', 'Ceramic', '#d9d9d4'], ['Mazda', 'Platinum Quartz', '#b5aea3'], ['Mazda', 'Artisan Red', '#6d1420'],
    ['Peugeot', 'Rouge Elixir', '#8e1622'], ['Peugeot', 'Bleu Vertigo', '#1d4fa0'], ['Peugeot', 'Gris Artense', '#55595d'], ['Peugeot', 'Gris Platinium', '#9ea1a3'], ['Peugeot', 'Blanc Nacré', '#efeee8'], ['Peugeot', 'Noir Perla Nera', '#121214'], ['Peugeot', 'Jaune Faro', '#e8b320'], ['Peugeot', 'Orange Fusion', '#d9601e'], ['Peugeot', 'Vert Olivine', '#5b6b4a'], ['Peugeot', 'Gris Sélénium', '#6f6c69'],
    ['Renault', 'Rouge Flamme', '#b3141c'], ['Renault', 'Bleu Iron', '#3d5a73'], ['Renault', 'Bleu Cosmos', '#1f3e8c'], ['Renault', 'Gris Titanium', '#7b7f82'], ['Renault', 'Gris Schiste', '#4f5458'], ['Renault', 'Blanc Glacier', '#f1f2ef'], ['Renault', 'Noir Étoilé', '#101113'], ['Renault', 'Orange Valencia', '#e2701f'], ['Renault', 'Jaune Fluo', '#d8d21c'], ['Renault', 'Vert Pistache', '#8db04b'],
    ['Citroën', 'Rouge Elixir', '#8e1622'], ['Citroën', 'Bleu Ice', '#a9c6d8'], ['Citroën', 'Bleu Eclipse', '#1d2c4a'], ['Citroën', 'Gris Platinium', '#9ea1a3'], ['Citroën', 'Blanc Banquise', '#f3f3f0'], ['Citroën', 'Noir Perla Nera', '#121214'], ['Citroën', 'Orange Power', '#e0601c'], ['Citroën', 'Sable', '#c8b796'],
    ['Dacia', 'Bleu Iron', '#3d5a73'], ['Dacia', 'Rouge Fusion', '#a3121d'], ['Dacia', 'Gris Comète', '#8c9092'], ['Dacia', 'Gris Highland', '#5d6266'], ['Dacia', 'Kaki Dusty', '#6e6c55'], ['Dacia', 'Orange Arizona', '#d3651f'], ['Dacia', 'Blanc Glacier', '#f1f2ef'], ['Dacia', 'Noir Nacré', '#131416'],
    ['Volkswagen', 'Gris Moonstone', '#7f8484'], ['Volkswagen', 'Bleu Atlantique', '#1f3550'], ['Volkswagen', 'Bleu Lapiz', '#1c4fa3'], ['Volkswagen', 'Rouge Kings', '#9e1b26'], ['Volkswagen', 'Blanc Pur', '#f4f4f2'], ['Volkswagen', 'Noir Intense', '#0f0f11'], ['Volkswagen', 'Argent Réflexe', '#b9bcbe'], ['Volkswagen', 'Vert Kings', '#3e6b4a'],
    ['Toyota', 'Rouge Tokyo', '#a5141d'], ['Toyota', 'Bleu Abysse', '#1d2e55'], ['Toyota', 'Gris Platine', '#a3a6a7'], ['Toyota', 'Gris Atlas', '#5a5e61'], ['Toyota', 'Blanc Pur', '#f3f3f1'], ['Toyota', 'Blanc Nacré', '#ecebe5'], ['Toyota', 'Noir Éclipse', '#111113'], ['Toyota', 'Orange Mandarine', '#e06a1f'],
    ['BMW', 'Bleu Portimao', '#1e4ea6'], ['BMW', 'Bleu Phytonic', '#22335a'], ['BMW', 'Gris Brooklyn', '#8d9396'], ['BMW', 'Gris Mineral', '#585d61'], ['BMW', 'Blanc Alpin', '#f2f3f2'], ['BMW', 'Noir Saphir', '#101114'], ['BMW', 'Rouge Melbourne', '#8b0f18'],
    ['Mercedes', 'Gris Montagne', '#6e7275'], ['Mercedes', 'Argent Iridium', '#a8abad'], ['Mercedes', 'Blanc Polaire', '#f2f2f0'], ['Mercedes', 'Noir Obsidienne', '#0e0f11'], ['Mercedes', 'Bleu Cavansite', '#1d2b45'], ['Mercedes', 'Rouge Hyacinthe', '#7e1220'],
    ['Audi', 'Gris Daytona', '#4d5154'], ['Audi', 'Gris Nardo', '#8d9092'], ['Audi', 'Bleu Navarre', '#1c3360'], ['Audi', 'Rouge Tango', '#a3151f'], ['Audi', 'Blanc Ibis', '#f1f1ef'], ['Audi', 'Noir Mythos', '#0f1012'],
    ['Tesla', 'Blanc Nacré Multicouche', '#f0efea'], ['Tesla', 'Noir Uni', '#0d0d0f'], ['Tesla', 'Gris Nuit Métallisé', '#55595d'], ['Tesla', 'Bleu Outremer', '#22408a'], ['Tesla', 'Rouge Ultra', '#a50f1d'], ['Tesla', 'Argent Vif', '#a7aaac'],
    ['Ford', 'Bleu Performance', '#1d4b9e'], ['Ford', 'Rouge Race', '#b0121b'], ['Ford', 'Gris Magnétique', '#55595c'], ['Ford', 'Blanc Glacier', '#f1f2ef'], ['Ford', 'Noir Agate', '#111214'],
    ['Fiat', 'Rouge Passione', '#b0121d'], ['Fiat', 'Blanc Gelato', '#f0eee6'], ['Fiat', 'Vert Rugiada', '#7aa59a'], ['Fiat', 'Bleu Dipinto di Blu', '#2a4e86'],
    ['Kia', 'Rouge Runway', '#a5141f'], ['Kia', 'Gris Penta', '#7c8184'], ['Kia', 'Bleu Gravity', '#2a3e5e'], ['Kia', 'Blanc Snow', '#f1f1ee'],
    ['Hyundai', 'Bleu Intense', '#1c3d8a'], ['Hyundai', 'Gris Shadow', '#4f5356'], ['Hyundai', 'Rouge Engine', '#9e121c'], ['Hyundai', 'Blanc Atlas', '#f1f1ef'],
    ['Skoda', 'Vert Rallye', '#2f6b3a'], ['Skoda', 'Bleu Race', '#1f4a9b'], ['Skoda', 'Gris Quartz', '#7c8183'], ['Seat', 'Rouge Désir', '#b3121d'], ['Seat', 'Bleu Mystery', '#1c3a6e'],
    ['Opel', 'Jaune Kult', '#f0c419'], ['Opel', 'Rouge Hot', '#b0121b'], ['Opel', 'Gris Quartz', '#7c8183'], ['Mini', 'Vert British Racing', '#1f3d2c'], ['Mini', 'Rouge Chili', '#b5121c'],
    ['Porsche', 'Bleu Gentiane', '#1f3f8e'], ['Porsche', 'Gris Craie', '#c8c8c3'], ['Volvo', 'Bleu Denim', '#3b5470'], ['Volvo', 'Gris Thunder', '#5a5e61'], ['Nissan', 'Rouge Fuji', '#a5141d'], ['Suzuki', 'Jaune Champion', '#f2c514'],
    ['', 'Rouge', '#c0151f'], ['', 'Bordeaux', '#6d1420'], ['', 'Bleu', '#1f4fa3'], ['', 'Bleu marine', '#1c2b4b'], ['', 'Bleu clair', '#7fb2dd'], ['', 'Vert', '#2f7a43'], ['', 'Jaune', '#f0c419'], ['', 'Orange', '#e0661d'],
    ['', 'Noir', '#111214'], ['', 'Blanc', '#f2f2f0'], ['', 'Gris', '#6f7477'], ['', 'Gris clair', '#a9acae'], ['', 'Argent', '#b8bbbd'], ['', 'Beige', '#cdbd9c'], ['', 'Marron', '#5a3d2b'], ['', 'Violet', '#5b2a86']
  ];
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  var EN = { red: 'rouge', blue: 'bleu', grey: 'gris', gray: 'gris', white: 'blanc', black: 'noir', green: 'vert', yellow: 'jaune', silver: 'argent', pearl: 'nacre' }; // « Deep Crystal Blue » ou « bleu » : les deux marchent
  var rows = P.map(function (p) { var words = norm(p[0] + ' ' + p[1]).split(' '); return { brand: p[0], name: p[1], color: p[2], words: words, brandWord: norm(p[0]) }; });
  // Classe les teintes par nombre de mots retrouvés ; il faut au moins un mot du nom de teinte (pas seulement la marque).
  function search(q, max) {
    var qs = norm(q).split(' ').filter(function (w) { return w.length > 1; }); if (!qs.length) return [];
    qs = qs.concat(qs.map(function (w) { return EN[w]; }).filter(Boolean));
    return rows.map(function (r) {
      var hitName = 0, hitBrand = 0;
      qs.forEach(function (w) { if (r.brandWord && r.brandWord.indexOf(w) === 0) hitBrand = 1; else if (r.words.some(function (x) { return x.indexOf(w) === 0; })) hitName++; });
      return { r: r, s: hitName ? hitName * 2 + hitBrand * 3 - (r.brand ? 0 : 1) : 0 };
    }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; }).slice(0, max || 6).map(function (x) { return { brand: x.r.brand, name: x.r.name, color: x.r.color, label: (x.r.brand ? x.r.brand + ' ' : '') + x.r.name }; });
  }
  window.FuelPaints = { search: search, list: P };
})();
