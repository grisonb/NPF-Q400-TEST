// =========================================================================
// CHAT - NOTIFICATIONS PUSH PWA
// =========================================================================
// À REMPLIR quand le serveur push sera en place.
// Exemple: const CHAT_PUSH_API_URL = 'https://ton-domaine.fr/api/chat-push';
// Exemple: const CHAT_PUSH_VAPID_PUBLIC_KEY = 'BAB6UkrM0OzfJPCKYux_BdLfQJbMo7qKoXPhIoTB99J93yCS69c5qk2VWYBz0aftsKwdpVrVm0JMmkdwrNRfBpY';
const CHAT_PUSH_API_URL = 'https://grisonb.synology.me:8443';
const CHAT_PUSH_VAPID_PUBLIC_KEY = 'BAB6UkrM0OzfJPCKYux_BdLfQJbMo7qKoXPhIoTB99J93yCS69c5qk2VWYBz0aftsKwdpVrVm0JMmkdwrNRfBpY';
let mqttLoaderPromise = null;

/*
 * v14.79 — repositionnement des repères des pélicandromes permanents.
 *
 * Les coordonnées ci-dessous ont été relevées et transmises par l’utilisateur
 * pour placer le rond / symbole cliquable au point opérationnel souhaité.
 * Elles ne modifient pas les seuils ni la géométrie des pistes.
 */
const pelicanAirports = [
    { oaci: "LFLU", name: "Valence-Chabeuil", lat: 44.91247778, lon: 4.96578056 }, { oaci: "LFMU", name: "Béziers-Vias", lat: 43.32189444, lon: 3.35176667 }, { oaci: "LFJR", name: "Angers-Marcé", lat: 47.560, lon: -0.312 }, { oaci: "LFHO", name: "Aubenas-Ardèche Méridionale", lat: 44.53824722, lon: 4.37033056 }, { oaci: "LFLX", name: "Châteauroux-Déols", lat: 46.85165833, lon: 1.71544444 }, { oaci: "LFBM", name: "Mont-de-Marsan", lat: 43.91028611, lon: -0.50519722 }, { oaci: "LFBL", name: "Limoges-Bellegarde", lat: 45.86016944, lon: 1.17707222 }, { oaci: "LFAQ", name: "Albert-Bray", lat: 49.972, lon: 2.698 }, { oaci: "LFBP", name: "Pau-Pyrénées", lat: 43.38329444, lon: -0.41828611 }, { oaci: "LFTH", name: "Toulon-Hyères", lat: 43.09991111, lon: 6.14021111 }, { oaci: "LFSG", name: "Épinal-Mirecourt", lat: 48.32211667, lon: 6.06405833 }, { oaci: "LFKC", name: "Calvi-Sainte-Catherine", lat: 42.52093889, lon: 8.79163889 }, { oaci: "LFMD", name: "Cannes-Mandelieu", lat: 43.55473889, lon: 6.95103333 }, { oaci: "LFKB", name: "Bastia-Poretta", lat: 42.55261389, lon: 9.48029444 }, { oaci: "LFMH", name: "Saint-Étienne-Bouthéon", lat: 45.53076944, lon: 4.29550556 }, { oaci: "LFKF", name: "Figari-Sud-Corse", lat: 41.50246667, lon: 9.09424444 }, { oaci: "LFCC", name: "Cahors-Lalbenque", lat: 44.34998611, lon: 1.47577778 }, { oaci: "LFML", name: "Marseille-Provence", lat: 43.43285833, lon: 5.20693889 }, { oaci: "LFKJ", name: "Ajaccio-Napoléon-Bonaparte", lat: 41.92130278, lon: 8.80351944 }, { oaci: "LFMK", name: "Carcassonne-Salvaza", lat: 43.21362500, lon: 2.31550278 }, { oaci: "LFRV", name: "Vannes-Meucon", lat: 47.71971667, lon: -2.72451111 }, { oaci: "LFTW", name: "Nîmes-Garons", lat: 43.74950833, lon: 4.41295000 }, { oaci: "LFMP", name: "Perpignan-Rivesaltes", lat: 42.73623611, lon: 2.87433333 }, { oaci: "LFBD", name: "Bordeaux-Mérignac", lat: 44.82121944, lon: -0.71088333 }, { oaci: "LFCR", name: "Rodez-Aveyron", lat: 44.4079, lon: 2.4827 }, { oaci: "LFBN", name: "Niort-Souché", lat: 46.3135, lon: -0.3945 }, { oaci: "LFGJ", name: "Dole-Tavaux", lat: 47.039, lon: 5.428 }
];


const waterPoints = [{"id":"AIGUEBLETTE","name":"Aigueblette","countryCode":"FR","lat":45.55,"lon":5.8},{"id":"AJACCIO","name":"Ajaccio","countryCode":"FR","lat":41.916667,"lon":8.75},{"id":"ANDANCE","name":"Andance","countryCode":"FR","lat":45.216667,"lon":4.8},{"id":"ANNECY","name":"Annecy","countryCode":"FR","lat":45.85,"lon":6.166667},{"id":"BAGES","name":"Bages","countryCode":"FR","lat":43.1,"lon":3.0},{"id":"BASSE_SEINE","name":"Basse Seine","countryCode":"FR","lat":49.433333,"lon":0.6},{"id":"BASTIA","name":"Bastia","countryCode":"FR","lat":42.516667,"lon":9.55},{"id":"BEAULIEU_MENTON","name":"Beaulieu-Menton","countryCode":"FR","lat":43.7,"lon":7.333333},{"id":"BEAUTIRAN","name":"Beautiran","countryCode":"FR","lat":44.716667,"lon":-0.45},{"id":"BEC_D_AMBES","name":"Bec D’Ambes","countryCode":"FR","lat":45.016667,"lon":-0.583333},{"id":"BERRE","name":"Berre","countryCode":"FR","lat":43.483333,"lon":5.1},{"id":"BISCAROSSE","name":"Biscarosse","countryCode":"FR","lat":44.35,"lon":-1.183333},{"id":"BORT_LES_ORGUES","name":"Bort Les Orgues","countryCode":"FR","lat":45.45,"lon":2.5},{"id":"BOULOGNE_SUR_GESSE","name":"Boulogne Sur Gesse","countryCode":"FR","lat":43.333333,"lon":0.666667},{"id":"BREST","name":"Brest","countryCode":"FR","lat":48.3,"lon":-4.433333},{"id":"CALVI","name":"Calvi","countryCode":"FR","lat":42.566667,"lon":8.783333},{"id":"CANNES_NICE","name":"Cannes-Nice","countryCode":"FR","lat":43.533333,"lon":7.083333},{"id":"CARRO","name":"Carro","countryCode":"FR","lat":43.35,"lon":5.016667},{"id":"CASTELLANE","name":"Castellane","countryCode":"FR","lat":43.9,"lon":6.533333},{"id":"CAZAUBON","name":"Cazaubon","countryCode":"FR","lat":43.933333,"lon":-0.05},{"id":"CAZAUX","name":"Cazaux","countryCode":"FR","lat":44.5,"lon":-1.15},{"id":"CHARMES","name":"Charmes","countryCode":"FR","lat":44.866667,"lon":4.85},{"id":"CHATEAUNEUF_DU_PAPE","name":"Chateauneuf Du Pape","countryCode":"FR","lat":44.033333,"lon":4.816667},{"id":"CHAUMARD","name":"Chaumard","countryCode":"FR","lat":47.15,"lon":3.9},{"id":"DER","name":"Der","countryCode":"FR","lat":48.583333,"lon":4.75},{"id":"DONGE","name":"Donge","countryCode":"FR","lat":47.3,"lon":-2.1},{"id":"DONZERE","name":"Donzere","countryCode":"FR","lat":44.45,"lon":4.7},{"id":"DUC","name":"Duc","countryCode":"FR","lat":47.95,"lon":-2.416667},{"id":"EGUZON","name":"Eguzon","countryCode":"FR","lat":46.4,"lon":1.616667},{"id":"FIGARI","name":"Figari","countryCode":"FR","lat":41.466667,"lon":9.066667},{"id":"FORET_D_ORIENT","name":"Foret D’Orient","countryCode":"FR","lat":48.266667,"lon":4.316667},{"id":"FOS","name":"Fos","countryCode":"FR","lat":43.4,"lon":4.933333},{"id":"GABAS","name":"Gabas","countryCode":"FR","lat":43.283333,"lon":-0.133333},{"id":"GOLFE_DU_MOBIHAN","name":"Golfe Du Mobihan","countryCode":"FR","lat":47.566667,"lon":-2.833333},{"id":"GRAU_DU_ROI","name":"Grau Du Roi","countryCode":"FR","lat":43.533333,"lon":4.116667},{"id":"GUERLEDAN","name":"Guerledan","countryCode":"FR","lat":48.2,"lon":-3.05},{"id":"HOURTIN","name":"Hourtin","countryCode":"FR","lat":45.133333,"lon":-1.116667},{"id":"HYERES","name":"Hyeres","countryCode":"FR","lat":43.066667,"lon":6.116667},{"id":"ILE_ROUSSE","name":"Ile Rousse","countryCode":"FR","lat":42.633333,"lon":8.95},{"id":"L_ESCOUROU","name":"L’Escourou","countryCode":"FR","lat":44.666667,"lon":0.35},{"id":"L_ESTRADE","name":"L’Estrade","countryCode":"FR","lat":43.333333,"lon":1.8},{"id":"LA_CIOTAT","name":"La Ciotat","countryCode":"FR","lat":43.166667,"lon":5.633333},{"id":"LA_HONCE","name":"La Honce","countryCode":"FR","lat":43.5,"lon":-1.383333},{"id":"LA_LIEZ","name":"La Liez","countryCode":"FR","lat":47.866667,"lon":5.4},{"id":"LA_MADINE","name":"La Madine","countryCode":"FR","lat":48.916667,"lon":5.733333},{"id":"LA_PIERRE_PERCEE","name":"La Pierre Percee","countryCode":"FR","lat":48.466667,"lon":6.916667},{"id":"LA_RANCE","name":"La Rance","countryCode":"FR","lat":48.43,"lon":-2.02},{"id":"LA_ROCHE_DE_GLUN","name":"La Roche De Glun","countryCode":"FR","lat":45.0,"lon":4.85},{"id":"LA_SALVETAT","name":"La Salvetat","countryCode":"FR","lat":43.6,"lon":2.616667},{"id":"LAC_LEMAN","name":"Lac Leman","countryCode":"FR","lat":46.416667,"lon":6.5},{"id":"LACANAU","name":"Lacanau","countryCode":"FR","lat":44.966667,"lon":-1.116667},{"id":"LAFFREY","name":"Laffrey","countryCode":"FR","lat":45.016667,"lon":5.783333},{"id":"LAVAUD","name":"Lavaud","countryCode":"FR","lat":45.816667,"lon":0.666667},{"id":"LE_BOURGET","name":"Le Bourget","countryCode":"FR","lat":45.733333,"lon":5.866667},{"id":"LE_BRUSC","name":"Le Brusc","countryCode":"FR","lat":43.1,"lon":5.8},{"id":"LE_LANVANDOU","name":"Le Lanvandou","countryCode":"FR","lat":43.133333,"lon":6.383333},{"id":"LE_STOCK","name":"Le Stock","countryCode":"FR","lat":48.766667,"lon":6.933333},{"id":"LE_VERDON","name":"Le Verdon","countryCode":"FR","lat":47.016667,"lon":-0.816667},{"id":"LEON","name":"Leon","countryCode":"FR","lat":43.9,"lon":-1.316667},{"id":"LES_MUREAUX","name":"Les Mureaux","countryCode":"FR","lat":49.0,"lon":1.933333},{"id":"LIBOURNE","name":"Libourne","countryCode":"FR","lat":44.916667,"lon":-0.316667},{"id":"LISSAC","name":"Lissac","countryCode":"FR","lat":45.1,"lon":1.45},{"id":"LORIENT","name":"Lorient","countryCode":"FR","lat":47.733333,"lon":-3.35},{"id":"MACON","name":"Macon","countryCode":"FR","lat":46.216667,"lon":4.8},{"id":"MARCKOLSHEIM","name":"Marckolsheim","countryCode":"FR","lat":48.183333,"lon":7.633333},{"id":"MAS_THIBERT","name":"Mas Thibert","countryCode":"FR","lat":43.566667,"lon":4.7},{"id":"MATEMALE","name":"Matemale","countryCode":"FR","lat":42.566667,"lon":2.1},{"id":"MELUN","name":"Melun","countryCode":"FR","lat":48.483333,"lon":2.683333},{"id":"MIMIZAN","name":"Mimizan","countryCode":"FR","lat":44.233333,"lon":-1.216667},{"id":"MOISSAC","name":"Moissac","countryCode":"FR","lat":44.083333,"lon":1.0},{"id":"MONTBEL","name":"Montbel","countryCode":"FR","lat":42.966667,"lon":1.95},{"id":"MONTELIMAR","name":"Montelimar","countryCode":"FR","lat":44.6,"lon":4.733333},{"id":"MONTEYNARD","name":"Monteynard","countryCode":"FR","lat":44.9,"lon":5.683333},{"id":"MORCENX","name":"Morcenx","countryCode":"FR","lat":44.033333,"lon":-0.85},{"id":"MORLAIX","name":"Morlaix","countryCode":"FR","lat":48.65,"lon":-3.866667},{"id":"NAUSSAC","name":"Naussac","countryCode":"FR","lat":44.75,"lon":3.8},{"id":"PINARELO_CIPRIANO","name":"Pinarelo-Cipriano","countryCode":"FR","lat":41.666667,"lon":9.383333},{"id":"PALADRU","name":"Paladru","countryCode":"FR","lat":45.45,"lon":5.533333},{"id":"PARELOUP","name":"Pareloup","countryCode":"FR","lat":44.216667,"lon":2.766667},{"id":"PAUILLAC","name":"Pauillac","countryCode":"FR","lat":45.166667,"lon":-0.716667},{"id":"PINCEMAILLE","name":"Pincemaille","countryCode":"FR","lat":47.466667,"lon":0.2},{"id":"PLOBSHEIM","name":"Plobsheim","countryCode":"FR","lat":48.433333,"lon":7.75},{"id":"POINTE_ROUGE","name":"Pointe Rouge","countryCode":"FR","lat":43.266667,"lon":5.333333},{"id":"PORT_DE_MARSEILLE","name":"Port De Marseille","countryCode":"FR","lat":43.333333,"lon":5.333333},{"id":"PORT_VENDRES","name":"Port Vendres","countryCode":"FR","lat":42.55,"lon":3.066667},{"id":"PORTO","name":"Porto","countryCode":"FR","lat":42.283333,"lon":8.666667},{"id":"PORTO_VECCHIO","name":"Porto Vecchio","countryCode":"FR","lat":41.6,"lon":9.3},{"id":"PROPRIANO","name":"Propriano","countryCode":"FR","lat":41.683333,"lon":8.9},{"id":"RHINAU","name":"Rhinau","countryCode":"FR","lat":48.35,"lon":7.75},{"id":"ROUCARIE","name":"Roucarie","countryCode":"FR","lat":44.083333,"lon":2.15},{"id":"SAGONE","name":"Sagone","countryCode":"FR","lat":42.1,"lon":8.7},{"id":"SALAGOU","name":"Salagou","countryCode":"FR","lat":43.65,"lon":3.383333},{"id":"SALSES","name":"Salses","countryCode":"FR","lat":42.816667,"lon":2.983333},{"id":"SANTA_MANZA","name":"Santa Manza","countryCode":"FR","lat":41.416667,"lon":9.233333},{"id":"SERRE_PONCON","name":"Serre Poncon","countryCode":"FR","lat":44.483333,"lon":6.3},{"id":"SOUSTON","name":"Souston","countryCode":"FR","lat":43.783333,"lon":-1.316667},{"id":"SAINT_CASSIEN","name":"Saint Cassien","countryCode":"FR","lat":43.6,"lon":6.816667},{"id":"SAINT_CHRISTOLY","name":"Saint Christoly","countryCode":"FR","lat":45.366667,"lon":-0.816667},{"id":"SAINT_ETIENNE_DE_CANTALES","name":"Saint Etienne De Cantales","countryCode":"FR","lat":44.933333,"lon":2.233333},{"id":"SAINT_ETIENNE_DES_SORTS","name":"Saint Etienne Des Sorts","countryCode":"FR","lat":44.183333,"lon":4.716667},{"id":"SAINT_FLORENT","name":"Saint Florent","countryCode":"FR","lat":42.7,"lon":9.3},{"id":"SAINT_MANDRIER","name":"Saint Mandrier","countryCode":"FR","lat":43.1,"lon":5.933333},{"id":"SAINT_MICHEL","name":"Saint Michel","countryCode":"FR","lat":48.35,"lon":-3.9},{"id":"SAINT_POINT","name":"Saint Point","countryCode":"FR","lat":46.816667,"lon":6.316667},{"id":"SAINT_RAPHAEL","name":"Saint Raphael","countryCode":"FR","lat":43.42,"lon":6.75},{"id":"SAINT_TROPEZ","name":"Saint Tropez","countryCode":"FR","lat":43.283333,"lon":6.616667},{"id":"SAINTE_CROIX","name":"Sainte Croix","countryCode":"FR","lat":43.75,"lon":6.166667},{"id":"THAU","name":"Thau","countryCode":"FR","lat":43.383333,"lon":3.616667},{"id":"URBINO","name":"Urbino","countryCode":"FR","lat":42.05,"lon":9.466667},{"id":"URT","name":"Urt","countryCode":"FR","lat":43.5,"lon":-1.283333},{"id":"VALLABREGUES","name":"Vallabregues","countryCode":"FR","lat":43.866667,"lon":4.633333},{"id":"VALRAS","name":"Valras","countryCode":"FR","lat":43.233333,"lon":3.283333},{"id":"VASSIVIERE","name":"Vassiviere","countryCode":"FR","lat":45.8,"lon":1.883333},{"id":"VICHY","name":"Vichy","countryCode":"FR","lat":46.133333,"lon":3.416667},{"id":"VIELLES_FORGES","name":"Vielles Forges","countryCode":"FR","lat":49.866667,"lon":4.616667},{"id":"VILLEFRANCHE_DE_PANAT","name":"Villefranche De Panat","countryCode":"FR","lat":44.1,"lon":2.7},{"id":"VILLEFRANCHE_SUR_SAONE","name":"Villefranche Sur Saone","countryCode":"FR","lat":46.033333,"lon":4.75},{"id":"VILLENEUVE_DE_LA_RAHO","name":"Villeneuve De La Raho","countryCode":"FR","lat":42.633333,"lon":2.9},{"id":"VINCA","name":"Vinca","countryCode":"FR","lat":42.65,"lon":2.533333},{"id":"VOLGELSHEIM","name":"Volgelsheim","countryCode":"FR","lat":48.066667,"lon":7.566667},{"id":"VOUGLANS","name":"Vouglans","countryCode":"FR","lat":46.433333,"lon":5.7},{"id":"WANTZENAU","name":"Wantzenau","countryCode":"FR","lat":48.633333,"lon":7.833333},{"id":"ZI_PORTUAIRE_FOS","name":"Zi Portuaire Fos","countryCode":"FR","lat":43.416667,"lon":4.85}];


const otherAirports = [
    { oaci: "LFBC", name: "Cazaux", lat: 44.534, lon: -1.155 }, { oaci: "LFBH", name: "La Rochelle-Île de Ré", lat: 46.179, lon: -1.195 }, { oaci: "LFBF", name: "Toulouse-Francazal", lat: 43.546, lon: 1.365 }, { oaci: "LFBG", name: "Cognac-Châteaubernard", lat: 45.660, lon: -0.354 }, { oaci: "LFBI", name: "Poitiers-Biard", lat: 46.587, lon: 0.309 }, { oaci: "LFBK", name: "Saint-Brieuc-Armor", lat: 48.538, lon: -2.852 }, { oaci: "LFBO", name: "Toulouse-Blagnac", lat: 43.635, lon: 1.363 }, { oaci: "LFBT", name: "Tarbes-Lourdes-Pyrénées", lat: 43.185, lon: -0.003 }, { oaci: "LFBU", name: "Angoulême-Cognac", lat: 45.729, lon: 0.220 }, { oaci: "LFCU", name: "Avord", lat: 47.056, lon: 2.637 }, { oaci: "LFLA", name: "Auxerre-Branches", lat: 47.848, lon: 3.497 }, { oaci: "LFLC", name: "Clermont-Ferrand-Auvergne", lat: 45.786, lon: 3.169 }, { oaci: "LFLD", name: "Bourges", lat: 47.059, lon: 2.370 }, { oaci: "LFLL", name: "Lyon-Saint Exupéry", lat: 45.725, lon: 5.081 }, { oaci: "LFLN", name: "Saint-Yan", lat: 46.409, lon: 4.013 }, { oaci: "LFLS", name: "Grenoble-Isère", lat: 45.363, lon: 5.331 }, { oaci: "LFLV", name: "Vichy-Charmeil", lat: 46.167, lon: 3.403 }, { oaci: "LFLW", name: "Aurillac", lat: 44.887, lon: 2.418 }, { oaci: "LFLY", name: "Lyon-Bron", lat: 45.729, lon: 4.945 }, { oaci: "LFLZ", name: "Le Puy-Loudes", lat: 45.079, lon: 3.762 }, { oaci: "LFMC", name: "Le Luc-Le Cannet", lat: 43.385, lon: 6.368 }, { oaci: "LFMI", name: "Istres-Le Tubé", lat: 43.524, lon: 4.944 }, { oaci: "LFMN", name: "Nice-Côte d'Azur", lat: 43.665, lon: 7.215 }, { oaci: "LFMQ", name: "Le Castellet", lat: 43.253, lon: 5.786 }, { oaci: "LFMV", name: "Avignon-Provence", lat: 43.906, lon: 4.902 }, { oaci: "LFMY", name: "Salon-de-Provence", lat: 43.606, lon: 5.110 }, { oaci: "LFOA", name: "Avord", lat: 47.056, lon: 2.637 }, { oaci: "LFOC", name: "Châteaudun", lat: 48.058, lon: 1.378 }, { oaci: "LFOE", name: "Évreux-Fauville", lat: 49.028, lon: 1.218 }, { oaci: "LFOK", name: "Châlons-Vatry", lat: 48.776, lon: 4.185 }, { oaci: "LFOJ", name: "Orléans-Bricy", lat: 47.989, lon: 1.758 }, { oaci: "LFOP", name: "Rouen-Vallée de Seine", lat: 49.385, lon: 1.182 }, { oaci: "LFOQ", name: "Blois-Le Breuil", lat: 47.678, lon: 1.217 }, { oaci: "LFOR", name: "Chartres-Métropole", lat: 48.455, lon: 1.530 }, { oaci: "LFOT", name: "Tours-Val de Loire", lat: 47.432, lon: 0.722 }, { oaci: "LFOU", name: "Cholet-Le Pontreau", lat: 47.081, lon: -0.871 }, { oaci: "LFOV", name: "Laval-Entrammes", lat: 48.033, lon: -0.749 }, { oaci: "LFPB", name: "Paris-Le Bourget", lat: 48.969, lon: 2.441 }, { oaci: "LFPC", name: "Creil", lat: 49.253, lon: 2.520 }, { oaci: "LFPG", name: "Paris-Charles-de-Gaulle", lat: 49.009, lon: 2.547 }, { oaci: "LFPO", name: "Paris-Orly", lat: 48.723, lon: 2.379 }, { oaci: "LFPV", name: "Villacoublay-Vélizy", lat: 48.773, lon: 2.203 }, { oaci: "LFRB", name: "Brest-Bretagne", lat: 48.447, lon: -4.418 }, { oaci: "LFRC", name: "Cherbourg-Manche", lat: 49.650, lon: -1.478 }, { oaci: "LFRD", name: "Dinard-Pleurtuit-Saint-Malo", lat: 48.587, lon: -2.080 }, { oaci: "LFRE", name: "La Baule-Escoublac", lat: 47.289, lon: -2.348 }, { oaci: "LFRF", name: "Granville-Mont-Saint-Michel", lat: 48.887, lon: -1.564 }, { oaci: "LFRG", name: "Deauville-Normandie", lat: 49.365, lon: 0.154 }, { oaci: "LFRH", name: "Lorient-Bretagne-Sud", lat: 47.760, lon: -3.440 }, { oaci: "LFRI", name: "La Roche-sur-Yon-Les Ajoncs", lat: 46.702, lon: -1.381 }, { oaci: "LFRJ", name: "Landivisiau", lat: 48.527, lon: -4.156 }, { oaci: "LFRK", name: "Caen-Carpiquet", lat: 49.173, lon: -0.450 }, { oaci: "LFRL", name: "Lanvéoc-Poulmic", lat: 48.278, lon: -4.437 }, { oaci: "LFRM", name: "Le Mans-Arnage", lat: 47.949, lon: 0.203 }, { oaci: "LFRN", name: "Rennes-Saint-Jacques", lat: 48.070, lon: -1.732 }, { oaci: "LFRO", name: "Lannion-Côte de Granit Rose", lat: 48.755, lon: -3.472 }, { oaci: "LFRQ", name: "Quimper-Pluguffan", lat: 47.975, lon: -4.167 }, { oaci: "LFRS", name: "Nantes-Atlantique", lat: 47.153, lon: -1.607 }, { oaci: "LFRT", name: "Saint-Nazaire-Montoir", lat: 47.312, lon: -2.152 }, { oaci: "LFRU", name: "Morlaix-Ploujean", lat: 48.604, lon: -3.818 }, { oaci: "LFSD", name: "Dijon-Longvic", lat: 47.268, lon: 5.088 }, { oaci: "LFSF", name: "Metz-Nancy-Lorraine", lat: 48.981, lon: 6.251 }, { oaci: "LFSH", name: "Haguenau", lat: 48.790, lon: 7.820 }, { oaci: "LFSK", name: "Colmar-Houssen", lat: 48.110, lon: 7.359 }, { oaci: "LFSO", name: "Nancy-Ochey", lat: 48.577, lon: 5.955 }, { oaci: "LFSQ", name: "Luxeuil-Saint-Sauveur", lat: 47.779, lon: 6.353 }, { oaci: "LFQA", name: "Reims-Prunay", lat: 49.207, lon: 4.148 }, { oaci: "LFST", name: "Strasbourg-Entzheim", lat: 48.542, lon: 7.628 }, { oaci: "LFSX", name: "Montbéliard-Courcelles", lat: 47.487, lon: 6.852 }, { oaci: "LFYR", name: "Romorantin-Pruniers", lat: 47.352, lon: 1.670 }, { oaci: "LFYD", name: "Dinard", lat: 48.587, lon: -2.080 }, { oaci: "LFSR", name: "Reims-Champagne", lat: 49.308, lon: 4.045 }, { oaci: "LFPM", name: "Melun-Villaroche", lat: 48.604, lon: 2.676 }, { oaci: "LFOB", name: "Beauvais-Tillé", lat: 49.454, lon: 2.112 }, { oaci: "LFQN", name: "Saint-Omer-Wizernes", lat: 50.727, lon: 2.233 }, { oaci: "LFKS", name: "Solenzara", lat: 41.924, lon: 9.405 },

 // Terrains ajoutés depuis le PDF "piste revêtue > 1500 m"
    { oaci: "LFBA", name: "Agen-La Garenne", lat: 44.1747, lon: 0.5906 },
    { oaci: "LFBE", name: "Bergerac-Roumanière", lat: 44.8253, lon: 0.5186 },
    { oaci: "LFDN", name: "Rochefort-Saint-Agnant", lat: 45.8878, lon: -0.9831 },
    { oaci: "LFBZ", name: "Biarritz-Pays Basque", lat: 43.4683, lon: -1.5311 },
    { oaci: "LFSL", name: "Brive-Vallée de la Dordogne", lat: 45.0397, lon: 1.4856 },
    { oaci: "LFJL", name: "Metz-Nancy-Lorraine", lat: 48.9821, lon: 6.2513 },
    { oaci: "LFSB", name: "Bâle-Mulhouse", lat: 47.5896, lon: 7.5299 },
    { oaci: "LFGA", name: "Colmar-Houssen", lat: 48.1099, lon: 7.3590 },
    { oaci: "LFSI", name: "Saint-Dizier-Robinson", lat: 48.6360, lon: 4.8994 },
    { oaci: "LFOH", name: "Le Havre-Octeville", lat: 49.5339, lon: 0.0881 },
    { oaci: "LFOI", name: "Abbeville", lat: 50.1435, lon: 1.8319 },
    { oaci: "LFMO", name: "Orange-Caritat", lat: 44.1405, lon: 4.8667 },
    { oaci: "LFLB", name: "Chambéry-Savoie", lat: 45.6381, lon: 5.8802 },
    { oaci: "LFLP", name: "Annecy-Meythet", lat: 45.9292, lon: 6.0999 },
    { oaci: "LFLO", name: "Roanne-Renaison", lat: 46.0583, lon: 4.0014 },
    { oaci: "LFHP", name: "Le Puy-Loudes", lat: 45.0807, lon: 3.7629 },
    { oaci: "LFMT", name: "Montpellier-Méditerranée", lat: 43.5762, lon: 3.9630 },
    { oaci: "LFQQ", name: "Lille-Lesquin", lat: 50.5633, lon: 3.0869 },
    { oaci: "LFRZ", name: "Saint-Nazaire-Montoir", lat: 47.3122, lon: -2.1492 }
];

/*
 * v14.71 — aérodromes complémentaires PIAF.
 *
 * La liste embarquée ci-dessous reprend les aérodromes métropolitains et corses
 * disposant d'un code OACI à quatre lettres LFxx dans la table PIAF de la DGAC.
 * Les codes déjà présents dans pelicanAirports ou otherAirports sont exclus au
 * chargement afin de conserver leur symbole et leur comportement existants.
 * Les aérodromes restants sont purement informatifs : point noir simple et
 * popup limitée au code OACI et au nom.
 */
const piafMetropolitanAerodromesData = `
LFBP|PAU PYRENEES|43.37990|-0.41851
LFLS|GRENOBLE ISERE|45.36294|5.33266
LFRQ|QUIMPER PLUGUFFAN|47.97495|-4.16788
LFOT|TOURS VAL DE LOIRE|47.43184|0.72318
LFPG|PARIS CHARLES DE GAULLE|49.00975|2.54782
LFPO|PARIS ORLY|48.72328|2.37958
LFRC|CHERBOURG MAUPERTUS|49.65078|-1.47530
LFRH|LORIENT LANN BIHOUE|47.76053|-3.43995
LFTW|NIMES GARONS|43.75743|4.41634
LFBE|BERGERAC ROUMANIERE|44.82443|0.52053
LFBO|TOULOUSE BLAGNAC|43.63513|1.36786
LFBZ|BIARRITZ BAYONNE ANGLET|43.46831|-1.53116
LFKB|BASTIA PORETTA|42.55000|9.48485
LFLL|LYON SAINT EXUPERY|45.72564|5.08111
LFLX|CHATEAUROUX DEOLS|46.86031|1.72113
LFML|MARSEILLE PROVENCE|43.43663|5.21512
LFOH|LE HAVRE OCTEVILLE|49.53385|0.08812
LFPB|PARIS LE BOURGET|48.96952|2.44149
LFRD|DINARD PLEURTUIT SAINT MALO|48.58771|-2.07995
LFRK|CAEN CARPIQUET|49.17328|-0.44988
LFRN|RENNES SAINT JACQUES|48.07193|-1.73223
LFSD|DIJON-LONGVIC|47.26582|5.09498
LFBD|BORDEAUX MERIGNAC|44.82865|-0.71534
LFRB|BREST BRETAGNE|48.44713|-4.42175
LFGJ|DOLE TAVAUX|47.04269|5.43493
LFLB|CHAMBERY AIX LES BAINS|45.63927|5.88012
LFLC|CLERMONT FERRAND AUVERGNE|45.78597|3.16245
LFMV|AVIGNON CAUMONT|43.90658|4.90203
LFOP|ROUEN VALLEE DE SEINE|49.39095|1.18394
LFBF|TOULOUSE FRANCAZAL|43.54906|1.35726
LFMT|MONTPELLIER MEDITERRANEE|43.58326|3.96138
LFMU|BEZIERS VIAS|43.32343|3.35340
LFQQ|LILLE LESQUIN|50.56343|3.08682
LFRS|NANTES ATLANTIQUE|47.15702|-1.60781
LFAB|DIEPPE SAINT AUBIN|49.88263|1.08533
LFAI|NANGIS LES LOGES|48.59694|3.00806
LFAK|DUNKERQUE LES MOERES|51.04056|2.55028
LFAL|LA FLECHE THOREE LES PINS|47.69278|-0.00194
LFAM|BERCK SUR MER|50.42306|1.59194
LFAU|VAUVILLE|49.62278|-1.83000
LFBG|COGNAC CHATEAUBERNARD|45.65833|-0.31750
LFBN|NIORT SOUCHE|46.31342|-0.39443
LFBR|MURET LHERM|43.44916|1.26369
LFBS|BISCARROSSE PARENTIS|44.36806|-1.13222
LFCD|ANDERNOS LES BAINS|44.75500|-1.06500
LFCH|ARCACHON LA TESTE DE BUCH|44.59694|-1.11389
LFCJ|JONZAC NEULLES|45.48306|-0.42306
LFCN|NOGARO|43.76889|-0.03472
LFCO|OLORON HERRERE|43.16472|-0.56028
LFCP|PONS AVY|45.56583|-0.51361
LFCQ|GRAULHET MONTDRAGON|43.76861|2.00778
LFCS|BORDEAUX LEOGNAN SAUCATS|44.69917|-0.59722
LFCT|THOUARS|46.96194|-0.15278
LFCX|CASTELSARRASIN MOISSAC|44.08583|1.12694
LFCY|ROYAN MEDIS|45.63116|-0.97549
LFDA|AIRE SUR L'ADOUR|43.70861|-0.24722
LFDC|MONTENDRE MARCILLAC|45.27361|-0.45333
LFDF|SAINTE FOY LA GRANDE|44.85250|0.17556
LFDG|GAILLAC LISLE SUR TARN|43.88306|1.87417
LFDH|AUCH LAMOTHE|43.68684|0.60005
LFDI|LIBOURNE ARTIGUES DE LUSSAC|44.98500|-0.13611
LFDL|LOUDUN|47.03611|0.10083
LFDM|MARMANDE VIRAZEIL|44.49917|0.20028
LFDN|ROCHEFORT CHARENTE MARITIME|45.88953|-0.98239
LFDP|SAINT PIERRE D'OLERON|45.95778|-1.31139
LFDQ|CASTELNAU MAGNOAC|43.27750|0.51944
LFDR|LA REOLE FLOUDES|44.56695|-0.05725
LFDT|TARBES LALOUBERE|43.21500|0.07750
LFDU|LESPARRE SAINT LAURENT MEDOC|45.19778|-0.88222
LFDW|CHAUVIGNY|46.58333|0.64222
LFDY|BORDEAUX YVRAC|44.87722|-0.47917
LFEF|AMBOISE DIERRE|47.34056|0.94111
LFEJ|CHATEAUROUX VILLERS|46.84083|1.62000
LFEK|ISSOUDUN LE FAY|46.88861|2.04139
LFEL|LE BLANC|46.62000|1.08583
LFEN|TOURS SORIGNY|47.26667|0.69944
LFEV|GRAY SAINT ADRIEN|47.43222|5.62139
LFEY|ILE D'YEU|46.71750|-2.39250
LFFC|MANTES CHERENCE|49.07889|1.68972
LFFD|SAINT ANDRE DE L'EURE|48.89750|1.25083
LFFE|ENGHIEN MOISSELLES|49.04556|2.35194
LFFK|FONTENAY LE COMTE|46.44083|-0.79389
LFFQ|LA FERTE ALAIS|48.49953|2.32996
LFFU|CHATEAUNEUF SUR CHER|46.87111|2.37694
LFFV|VIERZON MEREAU|47.19472|2.06667
LFFW|MONTAIGU SAINT GEORGES|46.93222|-1.32722
LFFX|TOURNUS CUISERY|46.56139|4.97528
LFFY|ETREPAGNY|49.30611|1.63861
LFGB|MULHOUSE HABSHEIM|47.73722|7.42972
LFGF|BEAUNE CHALLANGES|47.01028|4.89639
LFGG|BELFORT CHAUX|47.70097|6.83083
LFGI|DIJON DAROIS|47.38528|4.94694
LFGL|LONS LE SAUNIER COURLAOUX|46.67500|5.46917
LFGO|PONT SUR YONNE|48.28944|3.24889
LFGZ|NUITS SAINT GEORGES|47.14222|4.96833
LFHC|PEROUGES MEXIMIEUX|45.86861|5.18611
LFHD|PIERRELATTE|44.39778|4.71694
LFHE|ROMANS SAINT PAUL|45.06472|5.10139
LFHF|RUOMS|44.44472|4.33278
LFHG|SAINT CHAMOND L'HORME|45.49194|4.53444
LFHH|VIENNE REVENTIN|45.46278|4.82778
LFHI|MORESTEL|45.68694|5.45250
LFHJ|LYON CORBAS|45.65278|4.91222
LFHV|VILLEFRANCHE TARARE|45.91998|4.63493
LFHW|BELLEVILLE VILLIE MORGON|46.14111|4.71389
LFHY|MOULINS MONTBEUGNY|46.53438|3.42161
LFIB|BELVES SAINT PARDOUX|44.78250|0.95889
LFIH|CHALAIS|45.26806|0.01694
LFIL|RION DES LANDES|43.91583|-0.94917
LFIM|SAINT GAUDENS MONTREJEAU|43.10750|0.61917
LFIT|TOULOUSE BOURG SAINT BERNARD|43.61111|1.72417
LFIX|ITXASSOU|43.33750|-1.42222
LFIY|SAINT JEAN D'ANGELY SAINT DENIS DU PIN|45.96520|-0.52436
LFJD|CORLIER|46.03972|5.49667
LFJE|LA MOTTE CHALANCON|44.49667|5.40333
LFJF|AUBENASSON|44.69528|5.15389
LFJI|MARENNES|45.82389|-1.07722
LFJR|ANGERS MARCE|47.56021|-0.31213
LFJT|TOURS LE LOUROUX|47.15000|0.71278
LFJU|LURCY LEVIS|46.71222|2.94472
LFJV|LASCLAVERIES|43.42528|-0.28694
LFKE|SAINT JEAN EN ROYANS|45.02639|5.30917
LFKH|SAINT JEAN D'AVELANNE|45.51583|5.67944
LFKK|MONTMEILLEUR|44.79361|5.76167
LFKL|LYON BRINDAS|45.71065|4.69665
LFKP|LA TOUR DU PIN CESSIEU|45.55889|5.38389
LFKY|BELLEY-PEYRIEU|45.69389|5.69167
LFLD|BOURGES|47.06079|2.37008
LFLE|CHAMBERY CHALLES LES EAUX|45.56056|5.97583
LFLG|GRENOBLE LE VERSOUD|45.21806|5.84861
LFLH|CHALON CHAMPFORGEUIL|46.82827|4.81706
LFLN|SAINT YAN|46.40649|4.02110
LFLO|ROANNE RENAISON|46.05278|3.99972
LFLP|ANNECY MEYTHET|45.93077|6.10629
LFLQ|MONTELIMAR ANCONE|44.58028|4.73917
LFLR|SAINT RAMBERT D'ALBON|45.25500|4.82472
LFLU|VALENCE CHABEUIL|44.91556|4.96874
LFLZ|FEURS CHAMBEON|45.70667|4.19694
LFME|NIMES COURBESSAC|43.85306|4.41444
LFMX|CHATEAU ARNOUX SAINT AUBAN|44.05861|5.99083
LFMZ|LEZIGNAN CORBIERES|43.17500|2.73278
LFNA|GAP TALLARD|44.45389|6.03667
LFNE|SALON EYGUIERES|43.65750|5.01278
LFNF|VINON|43.73639|5.78306
LFNH|CARPENTRAS|44.02250|5.09000
LFNJ|ASPRES SUR BUECH|44.51778|5.73611
LFNL|SAINT MARTIN DE LONDRES|43.80028|3.78167
LFNN|NARBONNE|43.19417|3.05167
LFNP|PEZENAS NIZAS|43.50472|3.41194
LFNR|BERRE LA FARE|43.53667|5.17750
LFNS|SISTERON THEZE|44.28667|5.92917
LFNT|AVIGNON PUJAUT|43.99611|4.75444
LFNU|UZES|44.08347|4.39383
LFNV|VALREAS VISAN|44.33583|4.90694
LFNZ|LE MAZET DE ROMANIN|43.77083|4.89444
LFOI|ABBEVILLE|50.14306|1.83250
LFOM|LESSAY|49.20333|-1.50472
LFOO|LES SABLES D'OLONNE TALMONT|46.47556|-1.72500
LFOQ|BLOIS LE BREUIL|47.67983|1.20578
LFOU|CHOLET LE PONTREAU|47.08191|-0.87722
LFOV|LAVAL ENTRAMMES|48.03225|-0.74278
LFOY|LE HAVRE SAINT ROMAIN|49.54389|0.35972
LFOZ|ORLEANS SAINT DENIS DE L'HOTEL|47.89762|2.16421
LFPD|BERNAY SAINT MARTIN|49.10250|0.56556
LFPF|BEYNES THIVERVAL|48.84361|1.90889
LFPH|CHELLES LE PIN|48.89667|2.60611
LFPL|LOGNES EMERAINVILLE|48.82194|2.62278
LFPQ|FONTENAY TRESIGNY|48.70611|2.90278
LFPU|MORET EPISY|48.34194|2.79944
LFPX|CHAVENAY VILLEPREUX|48.84222|1.98028
LFPZ|SAINT CYR L'ECOLE|48.81028|2.07333
LFQG|NEVERS FOURCHAMBAULT|47.00373|3.11074
LFQN|SAINT OMER WIZERNES|50.72944|2.23583
LFQO|LILLE MARCQ EN BAROEUL|50.68722|3.07556
LFQT|MERVILLE CALONNE|50.61660|2.64009
LFRI|LA ROCHE SUR YON LES AJONCS|46.70238|-1.38176
LFRM|LE MANS ARNAGE|47.94849|0.20165
LFRP|PLOERMEL LOYAT|48.00186|-2.37872
LFRU|MORLAIX PLOUJEAN|48.60075|-3.81667
LFRV|VANNES MEUCON|47.71924|-2.72338
LFRW|AVRANCHES LE VAL SAINT PERE|48.66083|-1.40583
LFSA|BESANCON THISE|47.27361|6.08306
LFSM|MONTBELIARD COURCELLES|47.48666|6.79147
LFSS|SAINT SULPICE DES LANDES|47.79167|-1.64361
LFTM|SERRES LA BATIE MONTSALEON|44.45722|5.72722
LFTN|LA GRAND'COMBE|44.24306|4.01111
LFTQ|CHATEAUBRIANT POUANCE|47.74056|-1.18806
LFXA|AMBERIEU|45.97972|5.33778
LFXB|SAINTES THENAC|45.70194|-0.63611
LFXU|LES MUREAUX|48.99861|1.94167
LFYR|ROMORANTIN PRUNIERS|47.32083|1.68889
LFAC|CALAIS DUNKERQUE|50.96093|1.95143
LFAE|EU MERS LE TREPORT|50.06917|1.42667
LFAT|LE TOUQUET PARIS PLAGE|50.51485|1.62758
LFBC|CAZAUX|44.53488|-1.13145
LFBH|LA ROCHELLE ILE DE RE|46.17921|-1.19524
LFBM|MONT DE MARSAN|43.91139|-0.51000
LFBY|DAX SEYRESSE|43.68917|-1.06889
LFCA|CHATELLERAULT TARGE|46.78028|0.55056
LFCI|ALBI LE SEQUESTRE|43.91328|2.11675
LFCK|CASTRES MAZAMET|43.55496|2.29059
LFCL|TOULOUSE LASBORDES|43.58778|1.49861
LFCW|VILLENEUVE SUR LOT|44.40028|0.76111
LFCZ|MIMIZAN|44.14583|-1.16472
LFDB|MONTAUBAN|44.02667|1.37694
LFDK|SOULAC SUR MER|45.49389|-1.08389
LFDX|FUMEL MONTAYRAL|44.45917|1.00722
LFEA|BELLE ILE|47.32611|-3.19889
LFEB|DINAN TRELIVAN|48.44333|-2.10333
LFEC|OUESSANT|48.46321|-5.06358
LFED|PONTIVY|48.05694|-2.92333
LFEH|AUBIGNY SUR NERE|47.48056|2.39417
LFEQ|QUIBERON|47.48139|-3.10167
LFER|REDON BAINS SUR OUST|47.69861|-2.03806
LFES|GUISCRIFF SCAER|48.05374|-3.66404
LFFI|ANCENIS|47.40722|-1.17889
LFGH|COSNE SUR LOIRE|47.36028|2.91833
LFHO|AUBENAS ARDECHE MERIDIONALE|44.53942|4.37173
LFHU|L'ALPE D'HUEZ|45.08750|6.08361
LFHX|LAPALISSE PERIGNY|46.25306|3.58750
LFIR|REVEL MONTGEY|43.48028|1.97889
LFIS|SAINT INGLEVERT LES DEUX CAPS|50.88250|1.73611
LFIV|VENDAYS MONTALIVET|45.38056|-1.11583
LFJB|MAULEON|46.90306|-0.69750
LFLM|MACON CHARNAY|46.29592|4.79586
LFLV|VICHY CHARMEIL|46.17178|3.40403
LFLY|LYON BRON|45.72952|4.93884
LFMA|AIX LES MILLES|43.50528|5.36722
LFMG|MONTAGNE NOIRE|43.40639|1.98917
LFMI|ISTRES LE TUBE|43.52239|4.92424
LFMO|ORANGE CARITAT|44.14009|4.86858
LFMQ|LE CASTELLET|43.25222|5.78611
LFMS|ALES CEVENNES|44.07273|4.14292
LFMW|CASTELNAUDARY VILLENEUVE|43.31111|1.92000
LFMY|SALON DE PROVENCE|43.60291|5.10817
LFNG|MONTPELLIER CANDILLARGUES|43.61017|4.07016
LFOA|AVORD|47.05694|2.63889
LFOD|SAUMUR SAINT FLORENT|47.25673|-0.11355
LFOE|EVREUX FAUVILLE|49.02861|1.22000
LFPM|MELUN VILLAROCHE|48.60528|2.67078
LFPN|TOUSSUS LE NOBLE|48.74976|2.11118
LFPT|PONTOISE CORMEILLES EN VEXIN|49.09663|2.04072
LFPV|VILLACOUBLAY VELIZY|48.77417|2.19169
LFPY|BRETIGNY SUR ORGE|48.59611|2.33222
LFQM|BESANCON LA VEZE|47.20531|6.08055
LFRE|LA BAULE ESCOUBLAC|47.28833|-2.34694
LFRF|GRANVILLE-MONT SAINT MICHEL|48.88287|-1.56383
LFRJ|LANDIVISIAU|48.53026|-4.15164
LFRL|LANVEOC POULMIC|48.28253|-4.44369
LFRO|LANNION|48.75444|-3.47194
LFRT|SAINT BRIEUC ARMOR|48.53749|-2.85654
LFRZ|SAINT NAZAIRE MONTOIR|47.31065|-2.15680
LFSC|COLMAR-MEYENHEIM|47.92194|7.39972
LFSQ|BELFORT FONTAINE|47.65556|7.01167
LFTH|HYERES LE PALYVESTRE|43.09734|6.14603
LFXI|SAINT CHRISTOL|44.05250|5.49389
LFXQ|COETQUIDAN|47.94389|-2.18194
LFYH|BROYE LES PESMES|47.31667|5.51667
LFBT|TARBES LOURDES PYRENEES|43.18545|-0.00289
LFMP|PERPIGNAN RIVESALTES|42.74083|2.86972
LFRG|DEAUVILLE NORMANDIE|49.36339|0.16000
LFBI|POITIERS BIARD|46.58740|0.30679
LFSB|BALE-MULHOUSE|47.58988|7.52922
LFBL|LIMOGES BELLEGARDE|45.86076|1.18031
LFCR|RODEZ MARCILLAC|44.40749|2.48331
LFJL|METZ NANCY LORRAINE|48.97828|6.24653
LFMK|CARCASSONNE SALVAZA|43.21582|2.30854
LFOK|CHALONS VATRY|48.77332|4.20616
LFST|STRASBOURG ENTZHEIM|48.54194|7.63444
LFMH|SAINT ETIENNE BOUTHEON|45.53405|4.29731
LFBU|ANGOULEME BRIE CHAMPNIERS|45.72948|0.21915
LFJY|CHAMBLEY|49.02547|5.87609
LFOB|BEAUVAIS TILLE|49.45442|2.11281
LFAD|COMPIEGNE MARGNY|49.43361|2.80472
LFAF|LAON CHAMBRY|49.59583|3.63167
LFAJ|ARGENTAN|48.70944|0.00278
LFAP|RETHEL PERTHES|49.48111|4.36333
LFAQ|ALBERT BRAY|49.97006|2.69262
LFAR|MONTDIDIER|49.67306|2.56917
LFAS|FALAISE MONTS D'ERAINES|48.92694|-0.14472
LFAV|VALENCIENNES DENAIN|50.32479|3.46544
LFAW|VILLERUPT|49.41056|5.88917
LFAY|AMIENS-GLISY|49.87310|2.38699
LFBK|MONTLUCON GUERET|46.22609|2.36282
LFBX|PERIGUEUX BASSILLAC|45.19749|0.81522
LFCB|BAGNERES DE LUCHON|42.80056|0.60111
LFCC|CAHORS LALBENQUE|44.35054|1.47859
LFCG|SAINT GIRONS ANTICHAN|43.00778|1.10306
LFCU|USSEL THALAMY|45.53583|2.42472
LFCV|VILLEFRANCHE DE ROUERGUE|44.36889|2.02694
LFDE|EGLETONS|45.42056|2.06778
LFDS|SARLAT DOMME|44.79222|1.24361
LFDV|COUHE VERAC|46.27056|0.18833
LFEG|ARGENTON SUR CREUSE|46.59583|1.60111
LFEI|BRIARE CHATILLON|47.61458|2.78185
LFEM|MONTARGIS VIMORY|47.96056|2.68583
LFEP|POUILLY MACONGE|47.22056|4.56028
LFET|TIL CHATEL|47.54639|5.21083
LFEU|BAR LE DUC LES HAUTS DE CHEE|48.86778|5.18417
LFEX|NANCY AZELOT|48.59194|6.23972
LFEZ|NANCY MALZEVILLE|48.72361|6.20639
LFFB|BUNO BONNEVAUX|48.35028|2.42444
LFFG|LA FERTE GAUCHER|48.75750|3.27889
LFFH|CHATEAU THIERRY BELLEAU|49.06667|3.35556
LFFJ|JOINVILLE MUSSEY|48.38528|5.14333
LFFL|BAILLEAU ARMENONVILLE|48.51472|1.63861
LFFN|BRIENNE LE CHATEAU|48.42972|4.48222
LFFP|PITHIVIERS|48.15639|2.19111
LFFR|BAR SUR SEINE|48.06611|4.41250
LFFT|NEUFCHATEAU|48.36167|5.72028
LFFZ|SEZANNE SAINT REMY|48.70944|3.76278
LFGA|COLMAR HOUSSEN|48.11035|7.35915
LFGC|STRASBOURG NEUHOF|48.55361|7.77750
LFGE|AVALLON|47.50194|3.89833
LFGK|JOIGNY|47.99444|3.39083
LFGN|PARAY LE MONIAL|46.46667|4.13306
LFGP|SAINT FLORENTIN CHEU|47.98139|3.77694
LFGQ|SEMUR EN AUXOIS|47.48111|4.34306
LFGR|DONCOURT LES CONFLANS|49.15194|5.93139
LFGS|LONGUYON VILLETTE|49.48361|5.57194
LFGT|SARREBOURG BUHL|48.71833|7.08000
LFGU|SARREGUEMINES NEUNKIRCH|49.12750|7.10667
LFGV|THIONVILLE YUTZ|49.35361|6.19972
LFGW|VERDUN SOMMEDIEUE|49.12218|5.47085
LFGX|CHAMPAGNOLE CROTENAY|46.76389|5.81972
LFHA|ISSOIRE LE BROC|45.51389|3.26611
LFHL|LANGOGNE LESPERON|44.70556|3.88722
LFHN|BELLEGARDE VOUVRAY|46.12333|5.80472
LFHP|LE PUY LOUDES|45.07966|3.76344
LFHR|BRIOUDE BEAUMONT|45.32389|3.35833
LFHS|BOURG CEYZERIAT|46.20562|5.29179
LFID|CONDOM VALENCE SUR BAISE|43.90917|0.38611
LFIF|SAINT AFFRIQUE BELMONT|43.82278|2.74722
LFIG|CASSAGNES BEGONHES|44.17833|2.51778
LFIK|RIBERAC SAINT AULAYE|45.23944|0.26583
LFJC|CLAMECY|47.43750|3.50750
LFJH|CAZERES PALAMINY|43.20083|1.05000
LFJS|SOISSONS COURMELLES|49.34500|3.28306
LFKM|SAINT GALMIER|45.60639|4.30500
LFLK|OYONNAX ARBENT|46.27861|5.66639
LFNO|FLORAC SAINTE ENIMIE|44.28556|3.46556
LFNQ|MONT LOUIS LA QUILLANE|42.54346|2.12002
LFNW|PUIVERT|42.91028|2.05472
LFNX|BEDARIEUX LA TOUR SUR ORB|43.63972|3.14472
LFOF|ALENCON VALFRAMBERT|48.44667|0.10833
LFON|DREUX VERNOUILLET|48.70583|1.36139
LFOR|CHARTRES METROPOLE|48.45889|1.52389
LFOS|SAINT VALERY VITTEFLEUR|49.83528|0.65556
LFOW|SAINT QUENTIN ROUPY|49.81694|3.20667
LFOX|ETAMPES MONDESIR|48.38111|2.07389
LFPA|PERSAN BEAUMONT|49.16500|2.31167
LFPE|MEAUX ESBLY|48.92694|2.83389
LFPK|COULOMMIERS VOISINS|48.83750|3.01444
LFPP|LE PLESSIS BELLEVILLE|49.10917|2.73694
LFQA|REIMS PRUNAY|49.20869|4.15658
LFQB|TROYES BARBEREY|48.32162|4.01662
LFQC|LUNEVILLE CROISMARE|48.59361|6.54222
LFQD|ARRAS ROCLINCOURT|50.32389|2.80278
LFQF|AUTUN BELLEVUE|46.97111|4.26111
LFQH|CHATILLON SUR SEINE|47.84528|4.57944
LFQJ|MAUBEUGE ELESMES|50.30833|4.03000
LFQK|CHALONS ECURY SUR COOLE|48.90556|4.35278
LFQL|LENS BENIFONTAINE|50.46639|2.81972
LFQS|VITRY EN ARTOIS|50.33833|2.99333
LFQU|SARRE UNION|48.95083|7.07639
LFQW|VESOUL FROTEY|47.63861|6.20417
LFQX|JUVANCOURT|48.11389|4.81944
LFQY|SAVERNE STEINBOURG|48.75333|7.42583
LFQZ|DIEUZE GUEBLANGE|48.77444|6.71417
LFSE|EPINAL DOGNEVILLE|48.21139|6.44833
LFSH|HAGUENAU|48.79694|7.81917
LFSJ|SEDAN DOUZY|49.65889|5.03667
LFSK|VITRY LE FRANCOIS VAUCLERC|48.70222|4.68333
LFSN|NANCY ESSEY|48.69209|6.22605
LFSP|PONTARLIER|46.90833|6.32917
LFSU|LANGRES ROLAMPONT|47.96417|5.29361
LFSV|PONT SAINT VINCENT|48.60000|6.05639
LFSW|EPERNAY PLIVOT|49.00444|4.08528
LFTP|PUIMOISSON|43.86889|6.16278
LFXG|BITCHE|49.06667|7.45000
LFXH|LE VALDAHON|47.16667|6.35000
LFYG|CAMBRAI NIERGNIES|50.14250|3.26500
LFYS|SAINTE LEOCADIE|42.44722|2.01083
LFYV|YVETOT-BAONS LE COMTE|49.63861|0.73250
LFAG|PERONNE SAINT QUENTIN|49.86886|3.02960
LFAO|BAGNOLES DE L'ORNE COUTERNE|48.54472|-0.38500
LFAX|MORTAGNE AU PERCHE|48.53972|0.53417
LFBA|AGEN LA GARENNE|44.17471|0.59062
LFBJ|SAINT JUNIEN|45.90250|0.91889
LFCE|GUERET SAINT LAURENT|46.17556|1.95306
LFCF|FIGEAC LIVERNON|44.67250|1.78806
LFCM|MILLAU LARZAC|43.98906|3.18330
LFDJ|PAMIERS LES PUJOLS|43.09068|1.69585
LFEW|SAULIEU LIERNAIS|47.23861|4.26444
LFGM|MONTCEAU LES MINES POUILLOUX|46.60333|4.33278
LFGY|SAINT DIE REMOMEIX|48.26639|7.00750
LFHQ|SAINT FLOUR COLTINES|45.07492|2.99264
LFHT|AMBERT LE POYET|45.51556|3.74500
LFHZ|SALLANCHES MONT BLANC|45.95000|6.63889
LFIP|PEYRESOURDE BALESTAS|42.79667|0.43556
LFJA|CHAUMONT SEMOUTIERS|48.09167|5.05000
LFKA|ALBERTVILLE|45.62722|6.32972
LFLA|AUXERRE BRANCHES|47.84633|3.49658
LFLI|ANNEMASSE|46.19194|6.26833
LFLT|MONTLUCON DOMERAT|46.35278|2.57056
LFLW|AURILLAC|44.89758|2.41672
LFNB|MENDE BRENOUX|44.50408|3.52763
LFOC|CHATEAUDUN|48.05788|1.37944
LFOG|FLERS SAINT PAUL|48.74972|-0.59472
LFOJ|ORLEANS BRICY|47.98778|1.76056
LFOL|L'AIGLE SAINT MICHEL|48.75889|0.65778
LFPC|CREIL|49.25361|2.51917
LFQE|ETAIN ROUVRES|49.22909|5.67605
LFQI|CAMBRAI EPINOY|50.21917|3.15222
LFQP|PHALSBOURG BOURSCHEID|48.76815|7.20513
LFQV|CHARLEVILLE MEZIERES|49.78505|4.64281
LFSF|METZ FRESCATY|49.07639|6.13389
LFSG|EPINAL MIRECOURT|48.32501|6.06674
LFSI|SAINT DIZIER ROBINSON|48.63354|4.90819
LFSL|BRIVE SOUILLAC|45.03964|1.48567
LFSO|NANCY OCHEY|48.58319|5.95453
LFSX|LUXEUIL SAINT SAUVEUR|47.78722|6.36500
LFSY|CESSEY BAIGNEUX LES JUIFS|47.60972|4.61750
LFTF|CUERS PIERREFEU|43.24759|6.12729
LFYD|DAMBLAIN|48.08611|5.66389
LFYM|MARIGNY LE GRAND|48.66000|3.83389
LFSR|REIMS CHAMPAGNE|49.31028|4.05083
LFMD|CANNES MANDELIEU|43.54639|6.95417
LFMF|FAYENCE|43.60806|6.70167
LFMC|LE LUC LE CANNET|43.38472|6.38694
LFTZ|LA MOLE|43.20639|6.48250
LFKC|CALVI SAINTE CATHERINE|42.52436|8.79301
LFKG|GHISONACCIA ALZITONE|42.05444|9.40028
LFKS|SOLENZARA|41.92639|9.40528
LFKF|FIGARI SUD CORSE|41.50211|9.09675
LFKJ|AJACCIO NAPOLEON BONAPARTE|41.92390|8.80244
LFMN|NICE COTE D'AZUR|43.66541|7.21498
LFKD|SOLLIERES SARDIERES|45.25389|6.80111
LFKR|SAINT REMY DE MAURIENNE|45.37503|6.27781
LFNC|MONT DAUPHIN SAINT CREPIN|44.70056|6.59917
LFHM|MEGEVE|45.82361|6.64917
LFKO|PROPRIANO|41.66028|8.89389
LFKT|CORTE|42.29028|9.19250
LFKX|MERIBEL|45.40750|6.57750
LFLJ|COURCHEVEL|45.39583|6.63250
LFMR|BARCELONNETTE SAINT PONS|44.38722|6.60917
`;

const existingAirportCodesForAdditionalDisplay = new Set(
    [...pelicanAirports, ...otherAirports]
        .map(airport => String(airport?.oaci || '').trim().toUpperCase())
        .filter(Boolean)
);

const piafMetropolitanAerodromes = piafMetropolitanAerodromesData
    .trim()
    .split('\n')
    .map(line => {
        const [oaci, name, latText, lonText] = line.split('|');
        return {
            oaci: String(oaci || '').trim().toUpperCase(),
            name: String(name || '').trim(),
            lat: Number(latText),
            lon: Number(lonText)
        };
    })
    .filter(airport => (
        /^[A-Z]{4}$/.test(airport.oaci)
        && airport.oaci.startsWith('LF')
        && airport.name
        && Number.isFinite(airport.lat)
        && Number.isFinite(airport.lon)
    ));

const piafMetropolitanAerodromeByOaci = new Map(
    piafMetropolitanAerodromes.map(airport => [airport.oaci, airport])
);

function calculateAirportPositionDeltaNm(lat1, lon1, lat2, lon2) {
    const toRadians = value => Number(value) * Math.PI / 180;
    const dLat = toRadians(Number(lat2) - Number(lat1));
    const dLon = toRadians(Number(lon2) - Number(lon1));
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
        * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    return (6371 * c) / 1.852;
}

/*
 * v16.47 — les positions `otherAirports` historiques sont parfois très
 * arrondies (ex. LFBG). PIAF devient la référence quand le code OACI pointe
 * vers une position cohérente avec l'ancien terrain. Un écart > 12 NM est
 * volontairement ignoré : il signale probablement une ancienne incohérence
 * code/nom et ne doit pas déplacer silencieusement le symbole à l'autre bout
 * de la France. Les pélicandromes permanents ne sont pas concernés.
 */
const OTHER_AIRPORT_PIAF_MAX_CORRECTION_NM = 12;
otherAirports.forEach(airport => {
    const reference = piafMetropolitanAerodromeByOaci.get(
        String(airport?.oaci || '').trim().toUpperCase()
    );
    if (!reference) return;
    const deltaNm = calculateAirportPositionDeltaNm(
        airport.lat, airport.lon, reference.lat, reference.lon
    );
    if (!Number.isFinite(deltaNm) || deltaNm > OTHER_AIRPORT_PIAF_MAX_CORRECTION_NM) return;
    airport.lat = reference.lat;
    airport.lon = reference.lon;
    airport.__npfPositionReference = 'PIAF';
});

const additionalAerodromes = piafMetropolitanAerodromes
    .filter(airport => !existingAirportCodesForAdditionalDisplay.has(airport.oaci));


/*
 * v14.76 — pistes intégrées à la carte NPF, indépendamment des symboles.
 *
 * Les données de la v14.75 restent entièrement embarquées dans script.js.
 * Les extrémités géographiques permettent à Leaflet d'afficher chaque piste
 * selon sa vraie orientation et sa vraie longueur à tous les niveaux de zoom.
 * Les pistes constituent désormais une couche cartographique non interactive,
 * placée sous les ronds d'aérodrome restaurés depuis la v14.74.
 *
 * Format :
 * OACI|QFU|lat1|lon1|lat2|lon2|longueur_m|largeur_m|surface|géométrie_estimée
 */
const additionalAerodromeRunwaysData = `
LFAB|13/31|49.885000|1.080946|49.880260|1.089713|820|0|UNK|1
LFAC|06/24|50.958801|1.945210|50.965401|1.964310|1535|45|ASP|0
LFAD|05/23|49.431009|2.799953|49.436211|2.809487|900|0|UNK|1
LFAE|05/23|50.066569|1.421840|50.071771|1.431500|900|18|PAVED|1
LFAF|17/35|49.600192|3.630483|49.591468|3.632856|985|0|UNK|1
LFAG|09/27|49.868698|3.019900|49.868401|3.039260|1390|30|ASP|0
LFAI|05/23|48.593899|3.001920|48.598999|3.012280|955|20|ASP|0
LFAJ|04/22|48.705995|-0.001600|48.712885|0.007160|1000|0|UNK|1
LFAL|08/26|47.692105|-0.011474|47.693454|0.007594|1435|80|GRASS|1
LFAM|06/24|50.420821|1.586530|50.425298|1.597350|914|46|GRASS|1
LFAO|12/30|48.548199|-0.393664|48.543400|-0.381225|1060|20|ASP|0
LFAP|06/24|49.479401|4.358775|49.482819|4.367885|760|60|GRS|1
LFAS|06/24|48.925029|-0.149758|48.928851|-0.139682|850|0|UNK|1
LFAT|13/31|50.523998|1.612470|50.512501|1.631390|1850|40|ASP|0
LFAV|06/24|50.327641|3.455589|50.330322|3.463281|625|50|GRS|0
LFAV|11/29|50.328541|3.450050|50.323074|3.472504|1708|45|ASP|0
LFAV|11L/29R|50.327705|3.457589|50.325737|3.465714|620|50|GRASS|0
LFAY|12/30|49.875500|2.379230|49.870499|2.394920|1300|25|ASP|0
LFBR|12/30|43.451401|1.257620|43.446899|1.269760|1100|30|ASP|0
LFBX|11/29|45.200401|0.805769|45.194099|0.826186|1750|30|ASP|0
LFBY|07/25|43.687940|-1.073565|43.690400|-1.064215|800|0|UNK|1
LFCA|18/36|46.783877|0.550560|46.776683|0.550560|800|0|UNK|1
LFCB|01/19|42.797239|0.600312|42.803881|0.601908|750|0|GRS|1
LFCD|13/31|44.758584|-1.071015|44.751416|-1.058986|1240|60|GRASS|1
LFCE|05/23|46.173609|1.949702|46.177511|1.956418|675|20|ASP|1
LFCF|11/29|44.673950|1.782747|44.671050|1.793373|900|30|PAVED|1
LFCG|15/33|43.012199|1.100070|43.003300|1.106230|1100|30|ASP|0
LFCH|07L/25R|44.595299|-1.118060|44.599400|-1.101110|1346|23|ASP|0
LFCH|07R/25L|44.594501|-1.118570|44.596401|-1.109520|1284|60|GRS|0
LFCI|09/27|43.913101|2.100940|43.913300|2.120380|1560|30|ASP|0
LFCJ|14L/32R|45.487779|-0.428708|45.478341|-0.417413|1370|0|UNK|1
LFCJ|14R/32L|45.487779|-0.428708|45.478341|-0.417413|1370|0|UNK|1
LFCK|14/32|43.562698|2.282100|43.549801|2.296260|1825|30|CON|0
LFCL|15/33|43.591145|1.496450|43.583382|1.501358|950|23|ASP|0
LFCM|14/32|43.995399|3.176530|43.983299|3.189460|1700|30|ASP|0
LFCN|14L/32R|43.772335|-0.038723|43.765445|-0.030718|1000|23|PAVED|1
LFCN|14R/32L|43.772162|-0.038523|43.765618|-0.030918|950|0|G|1
LFCO|07L/25R|43.163059|-0.566536|43.166381|-0.554023|1080|50|GRS|1
LFCO|07R/25L|43.163136|-0.566247|43.166304|-0.554313|1030|50|GRS|1
LFCP|13/31|45.569443|-0.519761|45.562217|-0.507460|1250|80|GRASS|1
LFCQ|09/27|43.770302|2.005800|43.769199|2.017700|965|20|ASP|0
LFCS|03/21|44.696055|-0.599750|44.702285|-0.594689|800|20|PAVED|1
LFCT|12/30|46.964301|-0.158771|46.959579|-0.146789|1050|100|G|1
LFCV|13/31|44.371853|2.022001|44.365927|2.031879|1025|0|UNK|1
LFCW|10/28|44.398998|0.753894|44.397099|0.766661|1040|18|ASP|0
LFCX|10/28|44.086533|1.121391|44.085127|1.132488|900|0|UNK|1
LFCY|10/28|45.631802|-0.980097|45.629601|-0.964328|1255|30|ASP|0
LFCZ|08/26|44.145500|-1.180880|44.146702|-1.168000|1040|20|ASP|0
LFDA|12/30|43.711899|-0.252222|43.708302|-0.240833|1000|30|ASP|0
LFDB|13/31|44.028801|1.373700|44.022598|1.382420|980|20|ASP|0
LFDC|15/33|45.276775|-0.455622|45.270445|-0.451038|790|60|SAND|1
LFDE|07/25|45.419306|2.062874|45.421813|2.072686|815|0|UNK|1
LFDF|10/28|44.853437|0.168064|44.851563|0.183056|1200|0|UNK|1
LFDG|07/25|43.881337|1.867604|43.884782|1.880736|1120|0|GRASS|1
LFDH|18/36|43.695363|0.600874|43.678317|0.599226|1900|30|CONCRETE|1
LFDH|36/18|43.676998|0.599197|43.690399|0.600358|1900|30|ASP|0
LFDI|04/22|44.978600|-0.138778|44.986599|-0.130722|1100|20|ASP|0
LFDJ|09/27|43.090801|1.689970|43.090401|1.705920|1300|30|ASP|0
LFDK|14/32|45.496381|-1.087321|45.491399|-1.080459|770|18|PAVED|1
LFDL|08/26|47.035550|0.095740|47.036440|0.106030|790|60|GRS|0
LFDM|11/29|44.500599|0.193328|44.497299|0.207697|1200|30|ASP|0
LFDP|10/28|45.958561|-1.317760|45.956999|-1.305020|1000|0|UNK|1
LFDR|08/26|44.566208|-0.063155|44.567692|-0.051345|950|0|UNK|1
LFDT|08/26|43.214352|0.072457|43.215648|0.082543|830|0|UNK|1
LFDU|06/24|45.195756|-0.887193|45.199803|-0.877246|900|60|GRASS|1
LFDV|02/20|46.266060|0.185961|46.275060|0.190700|1065|0|UNK|1
LFDX|17/35|44.462358|1.006432|44.455982|1.008008|720|0|GRASS|1
LFEA|06/24|47.323830|-3.205019|47.326771|-3.197414|660|25|ASP|0
LFEB|07/25|48.442053|-2.108617|48.444606|-2.098043|830|30|ASP|1
LFEC|05/23|48.460999|-5.067640|48.464699|-5.060830|833|24|PAVED|0
LFED|10/28|48.058899|-2.929330|48.058201|-2.914290|1120|30|ASP|0
LFEF|10/28|47.341106|0.936536|47.340013|0.945684|700|25|CONCRETE|1
LFEF|10L/28R|47.341106|0.936536|47.340013|0.945684|700|60|GRASS|1
LFEG|03L/21R|46.593377|1.599049|46.598283|1.603171|630|18|ASP|1
LFEG|03R/21L|46.592598|1.598394|46.599062|1.603826|830|65|GRS|1
LFEH|06/24|47.478500|2.388900|47.483101|2.400560|1015|20|ASP|0
LFEI|14/32|47.617508|2.778205|47.611652|2.785494|850|0|UNK|1
LFEJ|04/22|46.838074|1.616620|46.843586|1.623381|800|0|UNK|1
LFEK|11/29|46.890025|2.035702|46.887195|2.047078|920|0|UNK|1
LFEK|18/36|46.892882|2.041390|46.884338|2.041390|950|0|UNK|1
LFEL|04/22|46.617244|1.082464|46.622756|1.089197|800|0|UNK|1
LFEM|05/23|47.957091|2.679658|47.964028|2.692003|1200|50|GRASS|1
LFEM|05C/23C|47.957959|2.681201|47.963161|2.690460|900|80|GRS|1
LFEM|05L/23R|47.959693|2.684287|47.961427|2.687373|300|40|GRS|1
LFEN|04/22|47.264092|0.696780|47.269248|0.702101|700|18|HARD|1
LFEN|04R/22L|47.265454|0.698186|47.267886|0.700694|330|20|UNPAVED|1
LFEP|03/21|47.217250|4.557466|47.223870|4.563094|850|0|UNK|1
LFEQ|11/29|47.482695|-3.106451|47.480084|-3.096889|775|25|PAVED|1
LFER|05/23|47.696182|-2.042359|47.701038|-2.033761|840|0|UNK|1
LFES|02/20|48.046299|-3.668650|48.058800|-3.660910|1500|30|ASP|0
LFET|01/19|47.541790|5.209257|47.550990|5.212404|1050|100|TURF|1
LFET|11/29|47.547757|5.204204|47.545023|5.217455|1040|60|TURF|1
LFEU|06/24|48.865666|5.178605|48.869893|5.189735|940|0|UNK|1
LFEV|07L/25R|47.431219|5.615868|47.433221|5.626912|860|80|GRASS|1
LFEV|07R/25L|47.431289|5.616254|47.433151|5.626527|800|18|PAVED|1
LFEW|05/23|47.236681|4.260529|47.240539|4.268352|730|20|ASPHALT|1
LFEX|18/36|48.596347|6.239720|48.587533|6.239720|980|0|UNK|1
LFEY|04/22|46.715225|-2.394931|46.719498|-2.390639|575|50|GRS|0
LFEY|14/32|46.721321|-2.396814|46.712685|-2.386903|1220|25|ASP|0
LFEZ|04/22|48.720372|6.202272|48.726848|6.210509|940|0|UNK|1
LFEZ|09/27|48.723610|6.199983|48.723610|6.212797|940|0|UNK|1
LFEZ|14/32|48.727055|6.202008|48.720165|6.210771|1000|0|UNK|1
LFFB|10/28|48.350905|2.419109|48.349655|2.429771|800|0|UNK|1
LFFC|04/22|49.075790|1.685749|49.081990|1.693692|900|0|UNK|1
LFFC|12/30|49.080913|1.684369|49.076866|1.695070|900|0|UNK|1
LFFD|05/23|48.894320|1.245067|48.900679|1.256594|1100|0|UNK|1
LFFG|04/22|48.754226|3.273918|48.760097|3.282562|850|50|GRS|0
LFFH|04/22|49.063466|3.351458|49.069873|3.359663|930|0|UNK|1
LFFI|07/25|47.406601|-1.185170|47.409801|-1.169960|1200|25|ASP|0
LFFJ|09/27|48.385435|5.138867|48.385125|5.147793|660|60|GRASS|1
LFFK|08/26|46.440080|-0.800059|46.441579|-0.787721|960|0|UNK|1
LFFL|08/26|48.514111|1.633396|48.515329|1.643824|780|0|UNK|1
LFFL|18/36|48.518227|1.638610|48.511213|1.638610|780|0|UNK|1
LFFN|10/28|48.431499|4.464880|48.428101|4.497580|2450|45|CON|0
LFFP|07/25|48.154637|2.183889|48.158143|2.198331|1140|0|UNK|1
LFFQ|10/28|48.499527|2.329964|48.497787|2.343697|1033|90|UNK|0
LFFR|12/30|48.067909|4.407838|48.064311|4.417162|800|0|UNK|1
LFFT|01/19|48.358216|5.719363|48.365124|5.721197|780|0|UNK|1
LFFU|08/26|46.870485|2.371758|46.871735|2.382122|800|60|GRASS|1
LFFV|04/22|47.192378|2.063778|47.197062|2.069563|680|60|GRS|1
LFFW|07/25|46.930836|-1.332789|46.933604|-1.321651|900|0|UNK|1
LFFZ|06L/24R|48.707113|3.757351|48.711766|3.768209|950|50|UNPAVED|1
LFGB|02/20|47.737202|7.429690|47.745499|7.434730|1000|20|ASP|0
LFGB|02R/20L|47.736435|7.430345|47.745708|7.435896|965|80|GRASS|0
LFGB|16/34|47.739333|7.428577|47.735107|7.430863|500|50|GRASS|1
LFGC|17/35|48.557407|7.777069|48.550053|7.777832|820|60|ASPH|0
LFGF|03/21|47.001701|4.890310|47.010300|4.896430|910|30|ASP|0
LFGG|18L/36R|47.705107|6.830830|47.696833|6.830830|920|80|GRASS|1
LFGG|18R/36L|47.705107|6.830830|47.696833|6.830830|920|50|GRASS|1
LFGH|12/30|47.362101|2.913673|47.358459|2.922986|810|0|UNK|1
LFGI|02/20|47.382206|4.945345|47.388602|4.948511|750|20|ASPHALT|0
LFGI|02R/20L|47.381639|4.945760|47.388289|4.949053|780|80|TURF|0
LFGJ|05/23|47.033100|5.415340|47.044800|5.439190|2231|45|ASP|0
LFGK|08/26|47.991501|3.385220|47.993198|3.399610|1054|30|ASP|0
LFGK|08R/26L|47.993839|3.386213|47.995041|3.395447|700|80|TURF|1
LFGL|08/26|46.674141|5.462071|46.675859|5.476269|1100|0|UNK|1
LFGM|09/27|46.603330|4.326890|46.603330|4.338670|900|0|UNK|1
LFGN|13/31|46.468466|4.130164|46.464874|4.135956|597|101|TURF|1
LFGO|14L/32R|48.292885|3.244546|48.285995|3.253234|1000|0|UNK|1
LFGO|14R/32L|48.292885|3.244546|48.285995|3.253234|1000|0|UNK|1
LFGP|07C/25C|47.979729|3.770123|47.983051|3.783758|1080|0|UNK|1
LFGP|07L/25R|47.979667|3.769870|47.983112|3.784010|1120|0|UNK|1
LFGQ|04/22|47.478664|4.339801|47.483556|4.346319|732|25|ASPHALT|1
LFGQ|04L/22R|47.479038|4.340300|47.483182|4.345820|620|60|GRASS|1
LFGR|08/26|49.151237|5.925297|49.152643|5.937484|900|0|UNK|1
LFGS|09/27|49.483610|5.565711|49.483610|5.578169|900|50|GRS|1
LFGU|05L/23R|49.125436|7.102912|49.129564|7.110429|714|150|GRASS|1
LFGU|05R/23L|49.125436|7.102912|49.129564|7.110429|714|150|GRASS|1
LFGW|10/28|49.123199|5.461480|49.121498|5.476570|1120|20|ASP|0
LFGY|07/25|48.265052|7.001978|48.267728|7.013023|870|18|PAVED|1
LFGZ|11/29|47.143595|4.962776|47.140845|4.973884|894|60|TURF|1
LFHA|18L/36R|45.517725|3.265727|45.510055|3.266493|855|70|GRASS-HERBEP|1
LFHA|18R/36L|45.517725|3.265727|45.510055|3.266493|855|70|GRASS-HERBEA|1
LFHD|18R/36L|44.403176|4.716940|44.392384|4.716940|1200|0|UNK|1
LFHE|06/24|45.062618|5.096235|45.066822|5.106545|935|0|UNK|1
LFHF|18/36|44.447674|4.333136|44.442036|4.332519|630|50|GRASS|0
LFHH|01/19|45.459871|4.827049|45.465689|4.828511|657|47|GRASS|1
LFHI|13/31|45.689252|5.448555|45.684628|5.456445|800|0|UNK|1
LFHJ|18/36|45.656759|4.912220|45.648801|4.912220|885|0|UNK|1
LFHL|04/22|44.702348|3.883937|44.708772|3.890504|883|50|GRASS|1
LFHM|15/33|45.824501|6.648420|45.820000|6.651410|548|18|ASP|0
LFHN|01/19|46.120359|5.803964|46.126301|5.805476|671|18|PAVED|1
LFHQ|01/19|45.069901|2.991490|45.081501|2.994130|1310|30|ASP|0
LFHR|15L/33R|45.327406|3.355891|45.320374|3.360769|870|50|GRASS-HERBE-|1
LFHS|18/36|46.206001|5.292010|46.195801|5.292060|1139|30|ASP|0
LFHS|18R/36L|46.208925|5.291790|46.202315|5.291790|735|80|GRS|1
LFHT|02/20|45.512379|3.743698|45.518741|3.746302|736|18|PAVED|1
LFHU|06/24|45.086493|6.081139|45.088507|6.086081|448|30|ASP|1
LFHV|18/36|45.923302|4.635000|45.913898|4.634810|1040|30|ASP|0
LFHV|18L/36R|45.923500|4.636040|45.913799|4.635580|1100|80|GRS|0
LFHX|05/23|46.249664|3.581436|46.256456|3.593565|1200|23|PAVED|1
LFHY|08/26|46.533798|3.415330|46.535400|3.432120|1300|30|ASP|0
LFHY|08L/26R|46.534122|3.419486|46.534638|3.423734|330|30|GRS|1
LFHY|08R/26L|46.533722|3.416183|46.535038|3.427037|843|40|GRS|1
LFIB|11/29|44.783730|0.954127|44.781270|0.963652|800|0|UNK|1
LFID|11/29|43.910477|0.381125|43.907863|0.391095|850|0|UNK|1
LFIF|12/30|43.827900|2.739060|43.822300|2.753310|1300|20|ASP|0
LFIG|10/28|44.179798|2.512060|44.179100|2.525160|1050|20|CON|0
LFIH|07/25|45.266768|0.011897|45.269352|0.021983|840|0|UNK|1
LFIK|05/23|45.236954|0.261623|45.241926|0.270037|860|0|UNK|1
LFIL|05/23|43.912723|-0.954310|43.918937|-0.944029|1075|0|UNK|1
LFIP|09/27|42.796670|0.432680|42.796670|0.438440|470|20|ASP|1
LFIS|03/21|50.880128|1.734027|50.884871|1.738194|603|40|PAVED|1
LFIV|09/27|45.380560|-1.120951|45.380560|-1.110709|800|0|UNK|1
LFIY|10/28|45.965864|-0.529775|45.964536|-0.518945|850|50|GRASS|1
LFJA|01/19|48.079601|5.048100|48.093102|5.050000|1500|45|ASP|0
LFJB|04/22|46.899200|-0.701403|46.908600|-0.691374|1300|20|ASP|0
LFJC|18/36|47.441052|3.507500|47.433948|3.507500|790|0|UNK|1
LFJE|03/21|44.494591|5.401647|44.498749|5.405013|534|40|GRS|1
LFJF|08/26|44.694679|5.149093|44.695881|5.158687|770|0|UNK|1
LFJH|10/28|43.201525|1.044593|43.200135|1.055407|890|0|UNK|1
LFJS|07/25|49.343654|3.277385|49.346346|3.288735|875|55|GRASS|1
LFJT|03/21|47.146495|0.709805|47.153505|0.715756|900|90|GRASS|1
LFJU|06/24|46.709801|2.937650|46.717300|2.954140|1512|17|ASP|0
LFJU|06R/24L|46.709400|2.939530|46.712601|2.946850|661|38|GRS|0
LFJY|05/23|49.018600|5.863420|49.032299|5.888720|2400|45|ASP|0
LFKA|05/23|45.624956|6.325723|45.629484|6.333718|800|21|ASP|1
LFKG|18/36|42.058037|9.400280|42.050843|9.400280|800|0|UNK|1
LFKH|02/20|45.514110|5.678547|45.517550|5.680333|407|35|G|1
LFKM|16/34|45.609132|4.303573|45.603648|4.306427|649|10|GRASS|1
LFKO|09/27|41.661190|8.881392|41.659988|8.898122|1400|30|ASP|0
LFKT|12/30|42.296101|9.188610|42.291100|9.197780|940|20|ASP|0
LFKX|15/33|45.409081|6.576200|45.405919|6.578800|406|15|ASP|1
LFKY|18/36|45.696759|5.691670|45.691021|5.691670|638|60|G|1
LFLE|14/32|45.564602|5.972060|45.557499|5.979460|1000|20|ASP|0
LFLG|04/22|45.214960|5.844917|45.221160|5.852303|900|0|UNK|1
LFLH|17/35|46.832500|4.816120|46.819698|4.819160|1440|30|ASP|0
LFLI|12/30|46.194698|6.260850|46.189301|6.275930|1300|30|ASP|0
LFLJ|04/22|45.394036|6.630199|45.397624|6.634801|537|40|ASPHALT|1
LFLM|17/35|46.299718|4.795286|46.290011|4.796780|1230|24|ASP|0
LFLQ|02/20|44.575209|4.736579|44.585350|4.741761|1200|80|UNPAVED|1
LFLR|01L/19R|45.250983|4.824019|45.259017|4.825421|900|100|UNPAVED|1
LFLR|01R/19L|45.250983|4.824019|45.259017|4.825421|900|100|UNPAVED|1
LFLT|11/29|46.354099|2.564380|46.351002|2.576590|1000|30|ASP|0
LFMA|14/32|43.511600|5.362360|43.499699|5.373500|1504|30|ASP|0
LFME|18L/36R|43.857152|4.414440|43.848968|4.414440|910|60|UNK|1
LFME|18R/36L|43.857287|4.414440|43.848833|4.414440|940|60|GRASS|1
LFMF|10L/28R|43.608685|6.696777|43.607435|6.706563|800|0|UNK|1
LFMF|10R/28L|43.608708|6.696594|43.607412|6.706746|830|0|UNK|1
LFMR|09/27|44.387220|6.604136|44.387220|6.614204|800|0|UNK|1
LFMS|01/19|44.063499|4.140220|44.075802|4.144000|1395|30|ASP|0
LFMW|11/29|43.312356|1.915296|43.309864|1.924704|810|30|PAVED|1
LFMZ|08/26|43.174702|2.728440|43.176498|2.740560|1000|30|ASP|0
LFNA|02L/20R|44.449718|6.033910|44.457359|6.039140|945|30|ASP|0
LFNA|02R/20L|44.451302|6.035770|44.457001|6.039640|700|80|GRS|0
LFNB|12/30|44.505501|3.526190|44.498699|3.539520|1300|30|ASP|0
LFNC|16/34|44.704176|6.597439|44.696984|6.600945|847|30|ASPH|0
LFNC|16G/34G|44.704068|6.598241|44.698714|6.600829|630|79|GRASS|0
LFNE|09/27|43.657500|5.004700|43.657500|5.020860|1300|0|UNK|1
LFNE|15/33|43.662251|5.008988|43.652749|5.016571|1220|0|UNK|1
LFNF|02/20|43.731024|5.780357|43.741756|5.785763|1270|0|UNK|1
LFNF|10/28|43.737213|5.776600|43.735567|5.789520|1054|0|UNK|1
LFNG|14/32|43.613270|4.066567|43.607070|4.073753|900|30|PAVED|1
LFNH|13/31|44.033501|5.072500|44.026199|5.083790|1200|20|ASP|0
LFNJ|18/36|44.521827|5.736110|44.513733|5.736110|900|0|UNK|1
LFNL|12/30|43.801517|3.778702|43.799043|3.784637|550|70|GRASS|1
LFNO|09/27|44.285560|3.460598|44.285560|3.470522|790|0|UNK|1
LFNQ|14/32|42.546905|2.116097|42.540015|2.123943|1000|0|UNK|1
LFNR|08/26|43.536153|5.170714|43.537187|5.184286|1100|0|UNK|1
LFNR|16/34|43.540631|5.175292|43.532709|5.179707|950|0|UNK|1
LFNS|17/35|44.291851|5.927894|44.281489|5.930446|1170|0|UNK|1
LFNT|13/31|43.999492|4.748837|43.992728|4.760042|1170|0|UNK|1
LFNT|17R/35L|44.002088|4.752975|43.990132|4.755905|1350|0|UNK|1
LFNU|17/35|44.088164|4.392678|44.078776|4.394982|1060|0|UNK|1
LFNV|02/20|44.331520|4.904747|44.340140|4.909133|1020|50|GRASS|1
LFNX|18/36|43.644104|3.144720|43.635336|3.144720|975|0|UNK|1
LFOD|10/28|47.257401|-0.124586|47.256302|-0.105514|1450|30|ASP|0
LFOF|07/25|48.445478|0.103393|48.447862|0.113267|775|0|UNK|1
LFOG|05/23|48.747636|-0.598487|48.751804|-0.590953|721|25|PAVED|1
LFOL|07/25|48.757713|0.652877|48.760066|0.662683|765|0|UNK|1
LFOM|06/24|49.200519|-1.512170|49.206140|-1.497269|1250|80|GRASS|1
LFON|04/22|48.703213|1.358408|48.708477|1.364105|720|80|GRASS|0
LFOS|07/25|49.833896|0.649664|49.836664|0.661456|900|0|UNK|1
LFOX|06/24|48.379009|2.072597|48.382477|2.080508|700|23||0
LFOX|06L/24R|48.377964|2.066833|48.384041|2.080719|1230|50|ASPH|0
LFOY|01/19|49.539949|0.358649|49.547831|0.360791|890|0|UNK|1
LFOY|06/24|49.542001|0.354679|49.545778|0.364761|840|0|UNK|1
LFOZ|05/23|47.894100|2.157340|47.901699|2.172210|1600|30|ASP|0
LFPA|05/23|49.162361|2.306316|49.167638|2.317025|975|100|UNPAVED|1
LFPA|10L/28R|49.165648|2.306049|49.164352|2.317291|830|0|UNK|1
LFPA|10R/28L|49.165687|2.305710|49.164313|2.317630|880|0|UNK|1
LFPD|10/28|49.103195|0.557404|49.101715|0.573708|1200|80|GRASS|0
LFPE|07L/25R|48.926392|2.827178|48.930481|2.841522|1145|100|GRASS|0
LFPE|07R/25L|48.925407|2.828867|48.929241|2.842346|1075|100|GRASS|0
LFPE|16L/34R|48.930229|2.832833|48.921810|2.838348|1020|100|GRASS|0
LFPE|16R/34L|48.928970|2.831451|48.920547|2.836975|1020|100|GRASS|0
LFPF|12/30|48.845858|1.902973|48.841362|1.914807|1000|0|UNK|1
LFPH|04/22|48.894515|2.603640|48.898825|2.608580|600|50|GRASS|1
LFPH|11/29|48.897524|2.601858|48.895815|2.610362|650|50|GRASS|1
LFPK|09/27|48.837601|3.006270|48.837502|3.025330|1400|20|PEM|0
LFPK|09C/27C|48.837639|3.003639|48.837502|3.025306|1590|20|PAVED|0
LFPK|09L/27R|48.838699|3.014950|48.838600|3.023820|650|50|GRS|0
LFPK|09R/27L|48.835201|3.001140|48.835098|3.010160|660|80|GRS|0
LFPL|08/26|48.820591|2.621320|48.821510|2.630755|700|20|PAVED|0
LFPL|08R/26L|48.821251|2.615341|48.822628|2.630220|1100|100|GRASS|1
LFPN|07L/25R|48.751202|2.098730|48.754398|2.112900|1100|30|ASP|0
LFPN|07R/25L|48.749500|2.099740|48.752602|2.113180|1050|30|ASP|0
LFPP|07/25|49.107574|2.731686|49.110085|2.740461|698|19|ASPH|0
LFPP|07R/25L|49.106170|2.732170|49.109170|2.742330|823|50|GRASS|0
LFPQ|12L/30R|48.707636|2.898608|48.704584|2.906952|700|18|PAVED|1
LFPQ|12R/30L|48.707680|2.898489|48.704540|2.907071|720|50|GRASS|1
LFPT|04/22|49.087799|2.027400|49.098598|2.043650|1689|47|ASP|0
LFPT|12/30|49.101910|2.025665|49.095348|2.044373|1548|45|ASP|0
LFPU|06/24|48.340085|2.794607|48.343795|2.804274|825|0|GRASS|1
LFPX|05/23|48.839835|1.975962|48.844604|1.984598|825|60|GRASS|1
LFPX|10/28|48.842774|1.975503|48.841666|1.985057|710|100|GRASS|1
LFPZ|11L/29R|48.814682|2.062061|48.811562|2.073102|890|100|GRS|0
LFPZ|11R/29L|48.813400|2.062402|48.810387|2.073173|865|60|GRS|0
LFQB|05/23|48.317444|4.008744|48.321091|4.015575|734|100|GRS|0
LFQB|17/35|48.329498|4.015330|48.314701|4.017750|1650|30|ASP|0
LFQB|17R/35L|48.325600|4.012490|48.317501|4.013820|900|100|GRS|0
LFQC|09/27|48.593399|6.536410|48.593102|6.550500|1039|20|ASP|0
LFQC|09R/27L|48.593669|6.537122|48.593551|6.547318|750|75|GRASS|1
LFQE|01/19|49.216400|5.668340|49.237400|5.676070|2400|45|ASP|0
LFQF|18/36|46.971901|4.260570|46.962700|4.260460|1021|30|ASP|0
LFQF|18L/36R|46.971500|4.261090|46.965801|4.261090|636|50|GRS|0
LFQG|12/30|47.006500|3.104250|46.998699|3.122420|1630|30|ASP|0
LFQH|02/20|47.841173|4.577569|47.849387|4.581311|955|100|TURF|1
LFQJ|05L/23R|50.306018|4.025685|50.310642|4.034315|800|80|GRS|1
LFQJ|05R/23L|50.306400|4.026580|50.314201|4.040170|1300|30|ASP|0
LFQK|04L/22R|48.900393|4.346185|48.910727|4.359377|1500|70|GRASS|1
LFQK|04R/22L|48.900393|4.346185|48.910727|4.359377|1500|80|GRASS|1
LFQM|05/23|47.202801|6.076260|47.210300|6.091100|1400|23|ASP|0
LFQO|07L/25R|50.685931|3.069971|50.688509|3.081149|838|80|GRASS|1
LFQO|07R/25L|50.685931|3.069971|50.688509|3.081149|838|50|GRASS|1
LFQO|17L/35R|50.690984|3.074512|50.683456|3.076608|850|80|GRASS|1
LFQO|17R/35L|50.690984|3.074512|50.683456|3.076608|850|50|GRASS|1
LFQP|06/24|48.760899|7.187990|48.771500|7.213120|2196|45|ASP|0
LFQS|12/30|50.340353|2.987839|50.336306|2.998821|900|100|G|1
LFQT|04/22|50.611801|2.634340|50.624901|2.650150|1840|30|ASP|0
LFQU|09/27|48.950830|7.070433|48.950830|7.082347|870|0|UNK|1
LFQV|11/29|49.786499|4.637430|49.781399|4.656710|1500|30|ASP|0
LFQW|08/26|47.637699|6.194750|47.639500|6.213770|1442|20|ASP|0
LFQX|07/25|48.112506|4.813744|48.115274|4.825136|900|50|GRS|1
LFQZ|05/23|48.772055|6.709858|48.776824|6.718482|825|0|UNK|1
LFRP|10/28|48.002527|-2.384379|48.001192|-2.373062|855|0|UNK|1
LFSA|07/25|47.272118|6.077019|47.275102|6.089101|970|0|UNK|1
LFSE|02/20|48.208394|6.446694|48.214386|6.449966|709|99|GRASS|1
LFSM|08/26|47.485600|6.779460|47.488400|6.801610|1700|20|ASP|0
LFSN|03/21|48.686344|6.226664|48.699028|6.236978|1600|40|ASP|0
LFSP|02/20|46.900101|6.324620|46.908501|6.329270|1000|30|ASP|0
LFSU|18/36|47.968306|5.293718|47.960034|5.293502|920|60|TURF|1
LFSV|06/24|48.597302|6.049324|48.602698|6.063457|1200|0|UNK|1
LFSV|13/31|48.603324|6.050400|48.596676|6.062380|1150|0|UNK|1
LFSW|04/22|49.000306|4.079993|49.008573|4.090568|1200|50|GRASS|1
LFSW|10/28|49.005189|4.078799|49.003690|4.091760|960|50|GRASS|1
LFTF|11/29|43.250900|6.115300|43.244701|6.138090|1972|30|ASP|0
LFTP|08/26|43.868250|6.157743|43.869530|6.167817|820|0|UNK|1
LFTZ|06/24|43.202900|6.475590|43.207901|6.488410|1071|30|ASP|0
LFXA|01/19|45.978401|5.326780|45.996300|5.330110|2000|30|ASP|0
LFXA|02/20|45.976501|5.335350|45.983501|5.337940|800|100|GRS|0
LFXB|06/24|45.699916|-0.641128|45.703963|-0.631091|900|0|UNK|1
LFXB|06L/24R|45.699916|-0.641128|45.703963|-0.631091|900|0|UNK|1
LFXB|06R/24L|45.699916|-0.641128|45.703963|-0.631091|900|0|UNK|1
LFXB|12/30|45.703739|-0.640571|45.700141|-0.631649|800|0|UNK|1
LFXU|10L/28R|48.999928|1.929596|48.996998|1.955902|1950|50|GRASS|0
LFXU|10R/28L|48.999477|1.929474|48.996536|1.955780|1950|50|GRASS|0
LFYG|08L/26R|50.141797|3.258781|50.143203|3.271219|900|18|ASP|1
LFYG|08R/26L|50.141875|3.259472|50.143125|3.270528|800|100|GRS|1
LFYS|07/25|42.445990|2.006249|42.448450|2.015411|800|0|UNK|1
`;

const additionalAerodromeRunwaysByOaci = (() => {
    const byOaci = new Map();

    additionalAerodromeRunwaysData
        .trim()
        .split('\n')
        .forEach(line => {
            const [
                oaci,
                ident,
                leLatText,
                leLonText,
                heLatText,
                heLonText,
                lengthText,
                widthText,
                surface,
                estimatedText
            ] = line.split('|');

            const runway = {
                oaci: String(oaci || '').trim().toUpperCase(),
                ident: String(ident || '').trim(),
                leLat: Number(leLatText),
                leLon: Number(leLonText),
                heLat: Number(heLatText),
                heLon: Number(heLonText),
                lengthM: Number(lengthText),
                widthM: Number(widthText),
                surface: String(surface || '').trim(),
                estimated: estimatedText === '1'
            };

            if (
                !/^[A-Z]{4}$/.test(runway.oaci)
                || !Number.isFinite(runway.leLat)
                || !Number.isFinite(runway.leLon)
                || !Number.isFinite(runway.heLat)
                || !Number.isFinite(runway.heLon)
                || !Number.isFinite(runway.lengthM)
                || runway.lengthM <= 0
            ) return;

            if (!byOaci.has(runway.oaci)) byOaci.set(runway.oaci, []);
            byOaci.get(runway.oaci).push(runway);
        });

    return byOaci;
})();

function getAdditionalAerodromeRunways(oaci) {
    return additionalAerodromeRunwaysByOaci.get(
        String(oaci || '').trim().toUpperCase()
    ) || [];
}


/*
 * v14.77 — pistes des aérodromes déclarés comme pélicandromes.
 *
 * Les 27 pélicandromes permanents de la liste `pelicanAirports` disposent
 * désormais de leurs pistes dans la même représentation cartographique que
 * les aérodromes complémentaires. Les coordonnées exactes sont utilisées
 * lorsqu'elles sont disponibles. Quelques pistes secondaires sont reconstruites
 * sommairement autour de l'ARP et marquées `estimated: true`.
 *
 * Format :
 * OACI|QFU|lat1|lon1|lat2|lon2|longueur_m|largeur_m|surface|géométrie_estimée
 */
const declaredPelicanRunwaysData = `
LFLU|01/19|44.912201|4.968100|44.931000|4.971700|2100|45|ASP|0
LFLU|01L/19R|44.915600|4.969680|44.926201|4.971700|1193|50|GRASS|0
LFLU|01R/19L|44.919281|4.971359|44.922869|4.972071|403|60|GRASS|1
LFMU|09/27|43.324200|3.342750|43.322899|3.365060|1820|45|ASP|0
LFJR|08/26|47.558894|-0.324012|47.561705|-0.300388|1800|45|PAVED|1
LFJR|08L/26R|47.560535|-0.317133|47.561659|-0.307683|720|45|GRASS|1
LFJR|08R/26L|47.558644|-0.319210|47.560362|-0.304773|1100|100|GRASS|1
LFHO|18/36|44.550598|4.372800|44.537800|4.371580|1425|30|PAVED|0
LFLX|03/21|46.850601|1.719170|46.876900|1.744170|3500|45|CON|0
LFBM|09/27|43.910702|-0.531778|43.912300|-0.486964|3603|45|PEM|0
LFBL|03/21|45.852501|1.172540|45.871300|1.190200|2500|45|ASP|0
LFAQ|08/26|49.969330|2.678670|49.971001|2.709330|2200|45|PAVED|0
LFAQ|08R/26L|49.967445|2.678942|49.968185|2.692833|1000|80|GRASS|0
LFBP|13/31|43.387699|-0.433261|43.374500|-0.408242|2500|45|ASP|0
LFTH|05/23|43.094501|6.141120|43.106400|6.161470|2120|45|ASP|0
LFTH|13/31|43.101799|6.139940|43.089699|6.156430|1902|50|ASP|0
LFSG|08/26|48.324100|6.051820|48.326199|6.088100|2700|45|CON|0
LFKC|18/36|42.541100|8.792920|42.520302|8.793340|2310|40|CON|0
LFMD|04/22|43.543900|6.954110|43.548500|6.960830|760|18|ASP|0
LFMD|17/35|43.554501|6.950420|43.540298|6.952940|1540|45|ASP|0
LFMD|17L/35R|43.549921|6.951760|43.545050|6.952945|550|50|GRASS|1
LFKB|16/34|42.563499|9.479190|42.541801|9.488270|2520|45|ASP|0
LFMH|17/35|45.551201|4.295140|45.530499|4.297760|2300|45|ASP|0
LFKF|05/23|41.494701|9.086010|41.509800|9.107930|2480|45|ASP|0
LFCC|13/31|44.355598|1.467500|44.347198|1.481940|1500|30|ASP|0
LFML|13L/31R|43.449100|5.197310|43.427299|5.228460|3500|45|ASP|0
LFML|13R/31L|43.441299|5.203020|43.425900|5.224350|2370|45|ASP|0
LFKJ|02/20|41.911598|8.795420|41.931301|8.807690|2300|45|ASP|0
LFMK|09/27|43.217098|2.293170|43.215000|2.318230|2050|45|ASP|0
LFRV|08/26|47.723999|-2.731310|47.725201|-2.717780|1025|60|GRASS|0
LFTW|18/36|43.768398|4.415560|43.746399|4.417140|2440|45|CON|0
LFMP|15/33|42.754101|2.861710|42.735001|2.877750|2500|45|ASP|0
LFBD|05/23|44.819099|-0.728983|44.838699|-0.701000|3100|45|ASP|0
LFBD|11/29|44.831600|-0.729242|44.825401|-0.699897|2415|45|ASP|0
LFCR|13/31|44.413672|2.472636|44.402094|2.492636|2048|45|ASP|0
LFBN|07/25|46.308336|-0.412097|46.314492|-0.390731|1760|30|ASP|0
LFBN|07G/25G|46.309487|-0.405214|46.311778|-0.397005|680|80|GRASS|1
LFGJ|05/23|47.033086|5.415342|47.044781|5.439189|2231|45|ASP|0
`;

const declaredPelicanRunwaysByOaci = (() => {
    const byOaci = new Map();

    declaredPelicanRunwaysData
        .trim()
        .split('\n')
        .forEach(line => {
            const [
                oaci,
                ident,
                leLatText,
                leLonText,
                heLatText,
                heLonText,
                lengthText,
                widthText,
                surface,
                estimatedText
            ] = line.split('|');

            const runway = {
                oaci: String(oaci || '').trim().toUpperCase(),
                ident: String(ident || '').trim(),
                leLat: Number(leLatText),
                leLon: Number(leLonText),
                heLat: Number(heLatText),
                heLon: Number(heLonText),
                lengthM: Number(lengthText),
                widthM: Number(widthText),
                surface: String(surface || '').trim(),
                estimated: estimatedText === '1'
            };

            if (
                !/^[A-Z]{4}$/.test(runway.oaci)
                || !Number.isFinite(runway.leLat)
                || !Number.isFinite(runway.leLon)
                || !Number.isFinite(runway.heLat)
                || !Number.isFinite(runway.heLon)
                || !Number.isFinite(runway.lengthM)
                || runway.lengthM <= 0
            ) return;

            if (!byOaci.has(runway.oaci)) byOaci.set(runway.oaci, []);
            byOaci.get(runway.oaci).push(runway);
        });

    return byOaci;
})();



/*
 * v14.78 — couverture des pistes de tous les aéroports pouvant être
 * déclarés comme pélicandromes depuis l'interface.
 *
 * La v14.77 ne contenait que les 27 pélicandromes permanents. Les 97 terrains
 * de `otherAirports`, dont Montpellier, Nice et Tarbes, peuvent eux aussi être
 * enregistrés dans `customPelicanAirports`. Leurs géométries sont donc
 * embarquées localement afin que toute sélection PÉLIC dispose de sa ou ses
 * pistes à partir du zoom 1 NM.
 *
 * Les codes historiques conservés par NPF sont associés à la géométrie du
 * terrain correspondant par proximité géographique. Trois terrains dont les
 * seuils ne sont pas disponibles dans la base locale utilisent une géométrie
 * sommaire marquée `estimated: true`.
 *
 * Format :
 * OACI_NPF|QFU|lat1|lon1|lat2|lon2|longueur_m|largeur_m|surface|géométrie_estimée
 */
const otherAirportRunwaysData = `
LFBC|06/24|44.528000|-1.138010|44.540001|-1.112730|2408|45|ASP|0
LFBH|09/27|46.179699|-1.211010|46.178799|-1.181810|2255|45|ASP|0
LFBF|12/30|43.549099|1.357200|43.542301|1.377410|1800|45|ASP|0
LFBG|05/23|45.648411|-0.324381|45.662518|-0.300686|2423|45|PEM|0
LFBG|08/26|45.661861|-0.324158|45.663662|-0.301008|1814|60|MAC|0
LFBI|03/21|46.579601|0.300117|46.597900|0.315761|2350|45|ASP|0
LFBK|06/24|48.533100|-2.867380|48.543400|-2.841840|2200|45|ASP|0
LFBO|14L/32R|43.637402|1.357620|43.615601|1.380220|3000|45|ASP|0
LFBO|14R/32L|43.644100|1.345930|43.618999|1.372100|3500|45|ASP|0
LFBT|02/20|43.166000|-0.012750|43.191299|0.000069|3000|45|ASP|0
LFBU|10/28|45.730499|0.207131|45.728500|0.230214|1810|45|ASP|0
LFCU|06/24|47.047901|2.611770|47.063499|2.651840|3503|45|ASP|0
LFLA|18/36|47.857700|3.498210|47.842999|3.496100|1650|30|ASP|0
LFLC|08/26|45.784801|3.150820|45.788601|3.189160|3013|45|ASP|0
LFLD|06/24|47.056599|2.359880|47.063801|2.377330|1550|45|ASP|0
LFLL|17L/35R|45.734901|5.091870|45.710999|5.094780|2670|45|ASP|0
LFLL|17R/35L|45.746601|5.085940|45.710701|5.090300|4000|45|ASP|0
LFLN|15L/33R|46.422001|4.007120|46.406502|4.021100|2030|45|CON|0
LFLN|15R/33L|46.416500|4.007180|46.404999|4.017600|1500|30|CON|0
LFLS|09/27|45.362999|5.309910|45.362900|5.348840|3050|45|ASP|0
LFLV|01/19|46.159901|3.401720|46.179501|3.405750|2200|45|ASP|0
LFLW|15/33|44.897900|2.416940|44.884998|2.427440|1700|30|ASP|0
LFLY|16/34|45.735001|4.940930|45.719299|4.947610|1820|45|ASP|0
LFLZ|15/33|45.086300|3.758240|45.074902|3.767160|1393|30|Paved|0
LFLZ|15R/33L|45.083599|3.759090|45.077499|3.763680|940|80|Unpaved|0
LFMC|09/27|43.384499|6.378570|43.384701|6.388490|800|30|ASP|0
LFMC|13/31|43.388599|6.380470|43.380501|6.393670|1400|30|ASP|0
LFMI|15/33|43.537800|4.913300|43.507801|4.934620|3750|60|ASP|0
LFMN|04L/22R|43.651798|7.204040|43.669498|7.228510|2628|45|ASP|0
LFMN|04R/22L|43.646702|7.202490|43.665600|7.228440|2963|45|ASP|0
LFMQ|12/30|43.256802|5.777519|43.248466|5.792753|1545|30|ASP|0
LFMV|17/35|43.915600|4.899560|43.898998|4.904080|1880|45|ASP|0
LFMY|16/34|43.615700|5.104410|43.598801|5.113040|2001|45|CON|0
LFOA|06/24|47.047901|2.611770|47.063499|2.651840|3503|45|ASP|0
LFOC|10/28|48.059601|1.361340|48.056702|1.391910|2302|45|ASP|0
LFOE|04/22|49.018299|1.206710|49.039001|1.233020|2995|45|ASP|0
LFOK|10/28|48.779598|4.158410|48.772800|4.209930|3860|45|CON|0
LFOJ|07/25|47.983898|1.745560|47.991501|1.775690|2404|45|ASP|0
LFOP|04/22|49.379501|1.168450|49.390999|1.183940|1700|45|ASP|0
LFOQ|12/30|47.681599|1.202310|47.675999|1.215860|1250|30|ASP|0
LFOR|09/27|48.457165|1.514192|48.456787|1.525586|840|25|ASPH|0
LFOT|02/20|47.421799|0.723408|47.442699|0.731800|2404|45|CON|0
LFOU|03/21|47.076500|-0.880908|47.087799|-0.873217|1380|30|ASP|0
LFOV|14/32|48.038506|-0.751112|48.026672|-0.737479|1662|30|ASP|0
LFPB|03/21|48.948700|2.426860|48.970501|2.442150|2395|45|ASP|0
LFPB|07/25|48.963799|2.420290|48.973999|2.458250|3000|45|PEM|0
LFPB|09/27|48.963699|2.420400|48.965099|2.445630|1847|45|ASP|0
LFPC|07/25|49.249001|2.504170|49.258099|2.534090|2399|50|CON|0
LFPG|08H/26H|49.015769|2.558572|49.016089|2.564603|440|30|GRASS|0
LFPG|08L/26R|48.995701|2.552740|48.998798|2.610180|4215|45|ASP|0
LFPG|08R/26L|48.992901|2.565660|48.994900|2.602430|2700|60|CON|0
LFPG|09L/27R|49.024700|2.524890|49.026699|2.561690|2700|60|ASP|0
LFPG|09R/27L|49.020599|2.513060|49.023701|2.570290|4200|45|ASP|0
LFPO|02/20|48.717499|2.376700|48.737999|2.386970|2400|60|CON|0
LFPO|06/24|48.720001|2.316920|48.735500|2.360680|3650|45|ASP|0
LFPO|07/25|48.719398|2.358590|48.727402|2.402070|3320|45|CON|0
LFPV|09/27|48.774101|2.189280|48.774601|2.213930|1813|45|ASP|0
LFRB|07L/25R|48.449799|-4.422420|48.451900|-4.413410|700|18|ASP|0
LFRB|07R/25L|48.443401|-4.438350|48.452301|-4.398690|3100|45|ASP|0
LFRC|10/28|49.652199|-1.486860|49.648102|-1.453660|2440|45|ASP|0
LFRD|12/30|48.590500|-2.088880|48.584999|-2.071300|1435|45|ASP|0
LFRD|17/35|48.598099|-2.082680|48.578602|-2.077560|2200|45|ASP|0
LFRE|11/29|47.290100|-2.351840|47.287601|-2.339830|950|25|ASP|0
LFRF|06/24|48.880501|-1.571490|48.884201|-1.559650|960|30|ASP|0
LFRG|12/30|49.370499|0.138714|49.360100|0.169933|2550|45|ASP|0
LFRH|02/20|47.756199|-3.441810|47.770599|-3.435610|1670|45|CON|0
LFRH|07/25|47.756302|-3.459170|47.763000|-3.428730|2403|45|CON|0
LFRI|10/28|46.703300|-1.388560|46.700600|-1.368690|1550|30|ASP|0
LFRJ|07/25|48.526699|-4.169170|48.533600|-4.134170|2700|45|CON|0
LFRK|12/30|49.181000|-0.466417|49.171101|-0.445169|1900|45|ASP|0
LFRK|12L/30R|49.179722|-0.457825|49.175571|-0.448881|800|50|GRASS|0
LFRL|05/23|48.278599|-4.450960|48.284901|-4.439210|1108|40|ASP|0
LFRL|13/31|48.283901|-4.446270|48.280201|-4.439340|650|54|GRS|0
LFRM|02/20|47.941898|0.197989|47.953800|0.204592|1420|30|ASP|0
LFRN|10/28|48.073700|-1.746100|48.070202|-1.718390|2100|45|ASP|0
LFRN|14/32|48.069901|-1.740500|48.063900|-1.733530|850|30|ASP|0
LFRO|11/29|48.756599|-3.482710|48.751999|-3.460770|1700|45|ASP|0
LFRQ|09/27|47.975700|-4.185340|47.974499|-4.156600|2150|45|ASP|0
LFRS|03/21|47.141602|-1.619540|47.164799|-1.601900|2900|45|ASP|0
LFRT|07/25|47.309101|-2.164430|47.315300|-2.133930|2400|45|ASP|0
LFRU|04/22|48.597698|-3.822940|48.608799|-3.808830|1617|36|ASP|0
LFSD|01/19|47.266302|5.082896|47.276722|5.087014|1200|23|ASP|0
LFSD|17/35|47.276600|5.093590|47.255100|5.096370|2400|45|ASP|0
LFSF|04/22|48.973400|6.240540|48.990799|6.262100|2500|45|ASP|0
LFSH|03/21|48.790401|7.814320|48.798302|7.820840|995|18|ASP|0
LFSH|03L/21R|48.791000|7.813160|48.798599|7.819510|963|80|Turf|0
LFSK|01/19|48.102600|7.356890|48.116699|7.361020|1610|30|ASP|0
LFSO|02/20|48.573002|5.949090|48.593399|5.959950|2401|45|CON|0
LFSQ|04/22|47.777199|6.357160|47.793701|6.376220|2315|36|ASP|0
LFSQ|11/29|47.791599|6.334540|47.783001|6.364410|2433|45|ASP|0
LFQA|07/25|49.206699|4.149810|49.210899|4.164290|1150|30|ASP|0
LFST|05/23|48.531200|7.616030|48.545399|7.640440|2400|45|ASP|0
LFSX|08/26|47.485600|6.779460|47.488400|6.801610|1700|20|ASP|0
LFYR|04L/22R|47.324797|1.693338|47.317681|1.683200|1100|100|GRASS|1
LFYR|04R/22L|47.323500|1.693887|47.317354|1.685132|950|100|GRASS|1
LFYD|12/30|48.590500|-2.088880|48.584999|-2.071300|1435|45|ASP|0
LFYD|17/35|48.598099|-2.082680|48.578602|-2.077560|2200|45|ASP|0
LFSR|07/25|49.313816|4.065809|49.306182|4.033637|2482|48|ASP|1
LFPM|01/19|48.606098|2.670980|48.617500|2.674850|1300|30|ASP|0
LFPM|10/28|48.606499|2.663290|48.602299|2.689290|1975|45|ASP|0
LFOB|04/22|49.454601|2.113020|49.462101|2.123270|1105|30|ASP|0
LFOB|12/30|49.458302|2.103850|49.446201|2.131740|2430|45|ASP|0
LFQN|03/21|50.729778|2.234035|50.725222|2.230326|570|100|GRASS|1
LFQN|09/27|50.727659|2.236399|50.727341|2.227961|595|20|ASP|1
LFKS|18/36|41.936199|9.405060|41.912601|9.405640|2627|45|CON|0
LFBA|11/29|44.177700|0.580428|44.170300|0.605494|2165|30|ASP|0
LFBE|09/27|44.825298|0.504950|44.823799|0.532603|2205|45|ASP|0
LFDN|12/30|45.896198|-0.997261|45.885101|-0.972519|2280|45|ASP|0
LFBZ|09/27|43.468201|-1.537230|43.468498|-1.509420|2250|45|ASP|0
LFSL|11/29|45.043999|1.472240|45.036201|1.496520|2100|45|asphalt|0
LFJL|04/22|48.973400|6.240540|48.990799|6.262100|2500|45|ASP|0
LFSB|07/25|47.587943|7.516868|47.591429|7.539109|1715|60|CON|0
LFSB|15/33|47.617699|7.509862|47.585933|7.531962|3900|60|CON|0
LFGA|01/19|48.102600|7.356890|48.116699|7.361020|1610|30|ASP|0
LFSI|11/29|48.640301|4.884360|48.631802|4.914470|2412|45|ASP|0
LFOH|04/22|49.526501|0.077586|49.541599|0.099325|2300|40|ASP|0
LFOI|02/20|50.138302|1.828650|50.148701|1.835130|1250|23|CON|0
LFMO|15/33|44.148899|4.859740|44.131302|4.877360|2411|60|CON|0
LFLB|18/36|45.647099|5.879480|45.629002|5.880960|2020|45|ASP|0
LFLP|04/22|45.923500|6.092160|45.935001|6.105340|1630|30|ASP|0
LFLP|04R/22L|45.925535|6.096976|45.931488|6.103766|845|59|grass|0
LFLO|02/20|46.049400|3.998230|46.062099|4.003560|1475|30|Paved|0
LFHP|15/33|45.086300|3.758240|45.074902|3.767160|1393|30|Paved|0
LFHP|15R/33L|45.083599|3.759090|45.077499|3.763680|940|80|Unpaved|0
LFMT|12L/30R|43.586102|3.955730|43.572800|3.982220|2600|50|ASP|0
LFMT|12R/30L|43.575802|3.951890|43.570202|3.963090|1100|30|ASP|0
LFQQ|01/19|50.560101|3.085460|50.573799|3.091140|1580|30|ASP|0
LFQQ|08/26|50.562901|3.083010|50.568501|3.122230|2825|45|ASP|0
LFRZ|07/25|47.309101|-2.164430|47.315300|-2.133930|2400|45|ASP|0
`;

const otherAirportRunwaysByOaci = (() => {
    const byOaci = new Map();

    otherAirportRunwaysData
        .trim()
        .split('\n')
        .forEach(line => {
            const [
                oaci,
                ident,
                leLatText,
                leLonText,
                heLatText,
                heLonText,
                lengthText,
                widthText,
                surface,
                estimatedText
            ] = line.split('|');

            const runway = {
                oaci: String(oaci || '').trim().toUpperCase(),
                ident: String(ident || '').trim(),
                leLat: Number(leLatText),
                leLon: Number(leLonText),
                heLat: Number(heLatText),
                heLon: Number(heLonText),
                lengthM: Number(lengthText),
                widthM: Number(widthText),
                surface: String(surface || '').trim(),
                estimated: estimatedText === '1'
            };

            if (
                !/^[A-Z]{4}$/.test(runway.oaci)
                || !Number.isFinite(runway.leLat)
                || !Number.isFinite(runway.leLon)
                || !Number.isFinite(runway.heLat)
                || !Number.isFinite(runway.heLon)
                || !Number.isFinite(runway.lengthM)
                || runway.lengthM <= 0
            ) return;

            if (!byOaci.has(runway.oaci)) byOaci.set(runway.oaci, []);
            byOaci.get(runway.oaci).push(runway);
        });

    return byOaci;
})();

const runwayCoverageMissingAirportCodes = [...pelicanAirports, ...otherAirports]
    .map(airport => airport.oaci)
    .filter(oaci => (
        !declaredPelicanRunwaysByOaci.has(oaci)
        && !otherAirportRunwaysByOaci.has(oaci)
    ));

if (runwayCoverageMissingAirportCodes.length) {
    console.warn(
        '[NPF v14.80] Aéroports sélectionnables sans piste :',
        runwayCoverageMissingAirportCodes.join(', ')
    );
}

const NPF_RUNWAY_MIN_ZOOM = 12; // Échelle cartographique NPF d'environ 1 NM.


