<?php

ini_set('display_errors', 1);
error_reporting(E_ALL);

require_once __DIR__ . '/../php/utility.php';

// =========================
// CONFIG — city-specific
// =========================

$bundesland = "NRW";
$city       = "Bielefeld";
$lat        = 52.02;   // map center latitude
$lng        = 8.53;    // map center longitude
$zoom       = 13;      // map initial zoom
$outFile    = __DIR__ . "/../bielefeld/data/schulen.geojson";

$license = 'Verwendete Daten: Ministeriums für Schule und Bildung '
         . '(<a href="https://www.schulministerium.nrw/open-data">MSB</a>), '
         . '<a href="https://www.govdata.de/dl-de/by-2-0">dl-de/by-2-0</a>';

$mapping = "Schulformen wurden über mapSchulform() in ein UI-Schema überführt.";

// =========================
// SCHULFORM MAPPING — NRW school-type codes → canonical schulform
// =========================

function mapSchulform($code) {
    $map = [
        // Allgemeinbildung
        "02" => "Grundschule",
        "04" => "Hauptschule",
        "06" => "Hauptschule",      // Volksschule (historisch)
        "10" => "Realschule",
        "14" => "Sekundarschule",
        "15" => "Gesamtschule",
        "16" => "Gesamtschule",     // Gemeinschaftsschule (NRW Versuch)
        "20" => "Gymnasium",
        // Förderschule
        "08" => "Förderschule",
        "19" => "Förderschule",
        "85" => "Förderschule",
        "87" => "Förderschule",
        "88" => "Förderschule",
        // Beruf / Weiterbildung
        "30" => "Berufsschule",
        "56" => "Berufsschule",
        "58" => "Berufsschule",
        // Freie Schulen
        "17" => "Freie Schule",     // Waldorfschule
        "18" => "Freie Schule",     // Hiberniaschule
    ];

    return $map[$code] ?? "Andere Schule";
}

// =========================
// LOAD SOURCE DATA
// =========================

$schools    = readCsv("schuldaten.csv");
$traeger    = indexBy(readCsv("key_traeger.csv"),              "Traegernummer");
$schulform  = indexBy(readCsv("key_schulformschluessel.csv"), "Schluessel");
$anzahl     = indexBy(readCsv("anzahlen.csv"),                 "Schulnummer");
$sozial     = indexBy(readCsv("sozialindex.csv"),              "Schulnummer");

// =========================
// TRANSFORM
// =========================

$features = [];

foreach ($schools as $s) {

    if (trim($s["Ort"] ?? '') !== $city) continue;
    if (empty($s["UTMRechtswert"]) || empty($s["UTMHochwert"])) continue;

    [$featureLat, $featureLng] = utmToLatLng((float)$s["UTMRechtswert"], (float)$s["UTMHochwert"]);

    $id   = $s["Schulnummer"] ?? null;
    $code = $s["Schulform"]   ?? null;

    $props = [];

    setProp($props, "id",             $id);
    setProp($props, "id_key",         "schulnummer");

    setProp($props, "schulname",      trim(($s["Schulbezeichnung_1"] ?? '') . ' ' . ($s["Schulbezeichnung_2"] ?? '')));
    setProp($props, "schulname_kurz", $s["Kurzbezeichnung"] ?? null);

    setProp($props, "schulform_raw",  $schulform[$code]["Schulform"] ?? null);
    setProp($props, "schulform",      mapSchulform($code));

    setProp($props, "traeger",        $traeger[$s["Traegernummer"]]["Traegerbezeichnung_1"] ?? null);

    setProp($props, "rechtsform_code", $s["Rechtsform"] ?? null);
    setProp($props, "rechtsform", match($s["Rechtsform"] ?? null) {
        "1"     => "öffentlich",
        "2"     => "privat",
        default => null
    });

    setProp($props, "regbezirk",  $s["Bezirksregierung"] ?? null);
    setProp($props, "ort",        $s["Ort"]              ?? null);
    setProp($props, "plz",        $s["PLZ"]              ?? null);
    setProp($props, "strasse",    $s["Strasse"]          ?? null);
    setProp($props, "bundesland", $bundesland);

    setProp($props, "telefon_vorwahl", $s["Telefonvorwahl"] ?? null);
    setProp($props, "telefon",         $s["Telefon"]        ?? null);
    setProp($props, "fax_vorwahl",     $s["Faxvorwahl"]     ?? null);
    setProp($props, "fax",             $s["Fax"]            ?? null);
    setProp($props, "email",           $s["E-Mail"]         ?? null);
    setProp($props, "internet",        $s["Homepage"]       ?? null);

    $props["specific"] = array_filter([
        "schueler"           => $anzahl[$id]["Anzahl"]               ?? null,
        "sozialindexstufe"   => $sozial[$id]["Sozialindexstufe"]     ?? null,
        "schulbetriebsdatum" => $s["Schulbetriebsdatum"]             ?? null,
        "gemeindeschluessel" => $s["Gemeindeschluessel"]             ?? null,
        "epsg"               => $s["EPSG"]                           ?? null,
        "traegernummer"      => $s["Traegernummer"]                  ?? null,
    ], fn($v) => $v !== null);

    $features[] = [
        "type"       => "Feature",
        "geometry"   => ["type" => "Point", "coordinates" => [$featureLng, $featureLat]],
        "properties" => $props,
    ];
}

// =========================
// OUTPUT
// =========================

$meta = [
    "city"           => $city,
    "lat"            => $lat,
    "lng"            => $lng,
    "zoom"           => $zoom,
    "lizenzhinweis"  => $license,
    "mappinghinweis" => $mapping,
];

writeGeoJson($outFile, $meta, $features);
