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
$zoom       = 11;      // map initial zoom
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
$traeger    = indexBy(readCsv("key_traeger.csv"),"Traegernummer");
$schulform  = indexBy(readCsv("key_schulformschluessel.csv"),"Schluessel");
$anzahl     = indexBy(readCsv("anzahlen.csv"),"Schulnummer");
$sozial     = indexBy(readCsv("sozialindex.csv"),"Schulnummer");
$bezreg     = indexBy(readCsv("key_bezreg.csv"),"Schlüssel");
$klassen    = groupBy(readCsv("opendata_Schuelerzahlen_nach_Klasse_Stand_01102022_0.csv"), "Schulnummer");

// =========================
// TRANSFORM
// =========================

$features = [];

foreach ($schools as $s) {

    if (trim($s["Ort"] ?? '') !== $city) continue;
    if (empty($s["UTMRechtswert"]) || empty($s["UTMHochwert"])) continue;

    [$featureLat, $featureLng] = utmToLatLng(
        (float)$s["UTMRechtswert"],
        (float)$s["UTMHochwert"]
    );

    $id       = $s["Schulnummer"] ?? null;
    $code     = $s["Schulform"] ?? null;
    $bezregid = $s["Bezirksregierung"] ?? null;

    $props = [];

    // =========================
    // BASE FIELDS
    // =========================

    setProp($props, "id", $id);
    setProp($props, "id_key", "schulnummer");

    setProp($props, "schulname",
        trim(($s["Schulbezeichnung_1"] ?? '') . ' ' . ($s["Schulbezeichnung_2"] ?? ''))
    );

    setProp($props, "schulname_kurz", $s["Kurzbezeichnung"] ?? null);

    setProp($props, "schulform_raw", $schulform[$code]["Schulform"] ?? null);
    setProp($props, "schulform", mapSchulform($code));

    setProp($props, "traeger", $traeger[$s["Traegernummer"]]["Traegerbezeichnung_1"] ?? null);

    setProp($props, "rechtsform_code", $s["Rechtsform"] ?? null);
    setProp($props, "rechtsform", match($s["Rechtsform"] ?? null) {
        "1" => "öffentlich",
        "2" => "privat",
        default => null
    });

    setProp($props, "betrieb_seit",
        $s["Schulbetriebsdatum"] ?? null
    );

    setProp($props, "regbezirk", $bezreg[$bezregid]["Bezirksregierung"] ?? null);

    setProp($props, "ort", $s["Ort"] ?? null);
    setProp($props, "bezirk", $s["Bezirk"] ?? null);          // optional falls vorhanden
    setProp($props, "ortsteil", $s["Ortsteil"] ?? null);      // falls vorhanden

    setProp($props, "plz", $s["PLZ"] ?? null);
    setProp($props, "strasse", $s["Strasse"] ?? null);

    setProp($props, "bundesland", $bundesland);

    // =========================
    // CONTACT
    // =========================

    setProp($props, "telefon_vorwahl", $s["Telefonvorwahl"] ?? null);
    setProp($props, "telefon", $s["Telefon"] ?? null);
    setProp($props, "fax_vorwahl", $s["Faxvorwahl"] ?? null);
    setProp($props, "fax", $s["Fax"] ?? null);
    setProp($props, "email", $s["E-Mail"] ?? null);
    setProp($props, "internet", $s["Homepage"] ?? null);

    // =========================
    // NEW FLAT METRICS (WICHTIG)
    // =========================

    setProp($props, "schuelerzahl",
        $anzahl[$id]["Anzahl"] ?? null
    );

    setProp($props, "klassengroesse_avg",
        avgKlassengroesse($klassen[$id] ?? []) ?? null
    );

    setProp($props, "sozialindex",
        $sozial[$id]["Sozialindexstufe"] ?? null
    );

    // =========================
    // EIGENSCHAFTEN (NEU)
    // =========================

    $eigenschaften = [];

    // Beispiel-Mapping (nur wenn Daten vorhanden)
    if (!empty($s["Ganztag"])) {
        $eigenschaften[] = $s["Ganztag"] === "ja"
            ? "gebundener_ganztag"
            : "offener_ganztag";
    }

    if (!empty($s["Jahrgangsuebergreifend"])) {
        $eigenschaften[] = "jahrgangsuebergreifend";
    }

    if (!empty($s["Inklusion"])) {
        $eigenschaften[] = "inklusion";
    }

    if (!empty($s["Bilingual"])) {
        $eigenschaften[] = "bilingual";
    }

    if (!empty($s["MINT"])) {
        $eigenschaften[] = "mint";
    }

    if (!empty($s["Musik"])) {
        $eigenschaften[] = "musik";
    }

    if (!empty($s["Sport"])) {
        $eigenschaften[] = "sport";
    }

    setProp($props, "eigenschaften",
        array_values(array_unique($eigenschaften))
    );

    // =========================
    // FEATURE
    // =========================

    $features[] = [
        "type"       => "Feature",
        "geometry"   => [
            "type" => "Point",
            "coordinates" => [$featureLng, $featureLat]
        ],
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
