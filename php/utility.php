<?php

/**
 * =========================
 * CSV LOADER
 * =========================
 * Reads a semicolon-delimited CSV file into an array of associative rows.
 * Handles the Excel-style "sep=;" first line, BOM stripping, and ragged rows.
 */
function readCsv($file, $delimiter = ";") {
    $rows = [];

    if (!file_exists($file)) {
        echo "File not found: $file\n";
        return $rows;
    }

    $handle = fopen($file, "r");
    if (!$handle) {
        echo "Cannot open: $file\n";
        return $rows;
    }

    // Skip Excel "sep=;" hint line if present
    $firstLine = fgets($handle);
    if (!str_starts_with(trim($firstLine), 'sep=')) {
        rewind($handle);
    }

    $header = fgetcsv($handle, 0, $delimiter);
    if (!$header) {
        echo "No header in: $file\n";
        return $rows;
    }

    // Strip BOM and whitespace from header fields
    $header = array_map(fn($h) => trim(preg_replace('/^\xEF\xBB\xBF/', '', $h)), $header);

    // Drop empty trailing column that Excel sometimes adds
    if (end($header) === '') array_pop($header);

    while (($data = fgetcsv($handle, 0, $delimiter)) !== false) {
        if (!$data) continue;

        $data = array_map('trim', $data);

        if (end($data) === '') array_pop($data);
        if (count(array_filter($data)) === 0) continue;

        // Pad or trim to match header length
        if (count($data) < count($header)) {
            $data = array_pad($data, count($header), null);
        } elseif (count($data) > count($header)) {
            $data = array_slice($data, 0, count($header));
        }

        $rows[] = array_combine($header, $data);
    }

    fclose($handle);
    return $rows;
}

/**
 * =========================
 * INDEX BY KEY
 * =========================
 * Turns a flat array of rows into a lookup map keyed by a given column.
 */
function indexBy($rows, $key) {
    $out = [];
    foreach ($rows as $row) {
        if (!isset($row[$key])) continue;
        $out[$row[$key]] = $row;
    }
    return $out;
}

/**
 * =========================
 * GROUP BY KEY
 * =========================
 * Turns a flat array of rows into a map of arrays, grouped by a given column.
 * Unlike indexBy(), multiple rows with the same key are all kept.
 */
function groupBy($rows, $key) {
    $out = [];
    foreach ($rows as $row) {
        if (!isset($row[$key])) continue;
        $out[$row[$key]][] = $row;
    }
    return $out;
}

/**
 * =========================
 * AVG KLASSEN SIZE
 * =========================
 * Given a group of class rows for one school (as returned by groupBy),
 * returns the average number of pupils per class, rounded to one decimal.
 * Rows without a numeric Anzahl_SuS are skipped.
 */
function avgKlassengroesse($klassenRows) {
    $values = array_filter(
        array_column($klassenRows, 'Anzahl_SuS'),
        fn($v) => is_numeric($v) && (int)$v > 0
    );

    if (count($values) === 0) return null;

    return round(array_sum($values) / count($values), 1);
}

/**
 * =========================
 * SAFE PROPERTY SET
 * =========================
 * Sets $arr[$key] = $value only when $value is non-null and non-empty string.
 */
function setProp(&$arr, $key, $value) {
    if ($value === null || $value === '') return;
    $arr[$key] = $value;
}

/**
 * =========================
 * UTM → WGS84
 * =========================
 * Converts EPSG:25832 (UTM zone 32N) easting/northing in metres to
 * WGS84 [latitude, longitude] in decimal degrees.
 *
 * Uses the full Helmert series (D^6 / D^5 terms) for sub-metre accuracy.
 */
function utmToLatLng($easting, $northing, $zone = 32) {
    // WGS84 ellipsoid
    $a  = 6378137.0;
    $e2 = 0.00669437999014; // first eccentricity squared

    $k0   = 0.9996;
    $lon0 = deg2rad($zone * 6 - 183); // central meridian

    $x = $easting - 500000.0;
    $y = $northing;

    // Meridional arc → footprint latitude
    $M   = $y / $k0;
    $mu  = $M / ($a * (1 - $e2/4 - 3*$e2**2/64 - 5*$e2**3/256));

    $e1   = (1 - sqrt(1 - $e2)) / (1 + sqrt(1 - $e2));
    $phi1 = $mu
        + (3*$e1/2    - 27*$e1**3/32)   * sin(2*$mu)
        + (21*$e1**2/16 - 55*$e1**4/32) * sin(4*$mu)
        + (151*$e1**3/96)               * sin(6*$mu)
        + (1097*$e1**4/512)             * sin(8*$mu);

    $sinP = sin($phi1);
    $cosP = cos($phi1);
    $tanP = tan($phi1);

    $N1 = $a / sqrt(1 - $e2 * $sinP**2);
    $T1 = $tanP**2;
    $C1 = ($e2 / (1 - $e2)) * $cosP**2;
    $R1 = $a * (1 - $e2) / (1 - $e2 * $sinP**2)**1.5;
    $D  = $x / ($N1 * $k0);
    $ep = $e2 / (1 - $e2); // second eccentricity squared

    $lat = $phi1
        - ($N1 * $tanP / $R1) * (
            $D**2/2
            - (5 + 3*$T1 + 10*$C1 - 4*$C1**2 - 9*$ep)         * $D**4/24
            + (61 + 90*$T1 + 298*$C1 + 45*$T1**2 - 252*$ep - 3*$C1**2) * $D**6/720
        );

    $lon = $lon0 + (
            $D
            - (1 + 2*$T1 + $C1)                                          * $D**3/6
            + (5 - 2*$C1 + 28*$T1 - 3*$C1**2 + 8*$ep + 24*$T1**2)      * $D**5/120
        ) / $cosP;

    return [rad2deg($lat), rad2deg($lon)];
}

/**
 * =========================
 * WRITE GEOJSON
 * =========================
 * Serialises a FeatureCollection array and writes it to $outFile.
 */
function writeGeoJson($outFile, $meta, $features) {
    $geojson = [
        "type"     => "FeatureCollection",
        "meta"     => $meta,
        "features" => $features,
    ];

    $json = json_encode($geojson, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    if (file_put_contents($outFile, $json) === false) {
        echo "ERROR: could not write $outFile\n";
        return false;
    }

    echo "GeoJSON written: $outFile (" . count($features) . " features)\n";
    return true;
}
