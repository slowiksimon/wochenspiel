// Abfuhrplan 2026 für Pfaffstätten (GVA Baden, „Amtliche Mitteilung“), Seiten 2 bis 4.
// Every list holds the pickup days as "MM-DD". Taken from the PDF by tools/muellplan.py and checked there: the weekday
// letter of every row, the colour of every table cell, and the rhythm of every kind of bin (each break in a rhythm lies
// on a public holiday). Dates that break a rhythm without a holiday (3-weekly paper on two Tuesdays) are kept as printed.
export const PLAN = {
  year: 2026,
  town: 'Pfaffstätten',
  source: 'Abfuhrplan 2026 des GVA Baden',
  // Restmüll, area 1 and area 2 (a day can hold both); the ash bin goes with the Restmüll of its area in the heating months
  rm1: [
    '01-05', '02-02', '03-02', '03-30', '04-27', '05-28', '06-22', '07-20', '08-17', '09-14', '10-12', '11-09',
    '12-07'
  ],
  rm2: [
    '01-08', '02-05', '03-05', '04-02', '04-30', '05-28', '06-25', '07-23', '08-20', '09-17', '10-15', '11-12',
    '12-10'
  ],
  at1: ['01-05', '02-02', '03-02', '03-30', '11-09', '12-07'],
  at2: ['01-08', '02-05', '03-05', '04-02', '11-12', '12-10'],
  bio: [
    '01-05', '01-19', '02-02', '02-16', '03-02', '03-16', '03-30', '04-13', '04-20', '04-27', '05-04', '05-11',
    '05-18', '05-27', '06-01', '06-08', '06-15', '06-22', '06-29', '07-06', '07-13', '07-20', '07-27', '08-03',
    '08-10', '08-17', '08-24', '08-31', '09-07', '09-14', '09-21', '09-28', '10-05', '10-12', '10-19', '10-27',
    '11-09', '11-23', '12-07', '12-21'
  ],
  gt: [
    '01-12', '01-26', '02-09', '02-23', '03-09', '03-23', '04-07', '04-20', '05-04', '05-18', '06-01', '06-15',
    '06-29', '07-13', '07-27', '08-10', '08-24', '09-07', '09-21', '10-05', '10-19', '11-02', '11-16', '11-30',
    '12-14', '12-28'
  ],
  gs: ['01-22', '03-05', '04-16', '05-28', '07-09', '08-20', '10-01', '11-12', '12-24'],
  ap: ['01-29', '04-02', '06-05', '08-06', '10-08', '12-10'],
  // housing estates and rented bins: paper every 3 weeks; 1100-litre Restmüll containers every 4 or every 2 weeks
  ap3: [
    '01-12', '02-02', '02-23', '03-16', '04-07', '04-27', '05-18', '06-09', '06-29', '07-20', '08-10', '09-01',
    '09-21', '10-12', '11-02', '11-23', '12-14'
  ],
  c4: [
    '01-14', '02-11', '03-11', '04-08', '05-06', '06-03', '07-01', '07-29', '08-26', '09-23', '10-21', '11-18',
    '12-16'
  ],
  c2: [
    '01-14', '01-28', '02-11', '02-25', '03-11', '03-25', '04-08', '04-22', '05-06', '05-20', '06-03', '06-17',
    '07-01', '07-15', '07-29', '08-12', '08-26', '09-09', '09-23', '10-07', '10-21', '11-04', '11-18', '12-02',
    '12-16', '12-30'
  ],
  holidays: {
    '01-01': 'Neujahr',
    '01-06': 'Heilige Drei Könige',
    '04-05': 'Ostersonntag',
    '04-06': 'Ostermontag',
    '05-01': 'Staatsfeiertag',
    '05-14': 'Christi Himmelfahrt',
    '05-24': 'Pfingstsonntag',
    '05-25': 'Pfingstmontag',
    '06-04': 'Fronleichnam',
    '08-15': 'Mariä Himmelfahrt',
    '10-26': 'Nationalfeiertag',
    '11-01': 'Allerheiligen',
    '11-15': 'Leopoldi',
    '12-08': 'Mariä Empfängnis',
    '12-25': 'Christtag',
    '12-26': 'Stefanitag'
  },
  // the streets of the two Restmüll areas, as the plan lists them
  streets1: [
    'Adolf Breyer-Gasse', 'Albrechtsstraße', 'Alzenauer Platz', 'Am Kanal', 'Am Mühlbach', 'An der Schleuse',
    'Anton Hofmann-Gasse', 'Anton Knopp-Gasse', 'Badener Straße', 'Bahngasse', 'Billrothgasse', 'Dr. Josef Dolp-Straße',
    'Elred Lippmann-Straße', 'Emil Kögler-Gasse', 'Ernst Kolba-Weg', 'Fassbinderweg', 'Feldgasse', 'Gartenweg',
    'Grenzgasse', 'Hauptplatz', 'Hauptstraße', 'Hausackerstraße', 'Heiligenkreuzergasse', 'Hörsteinergasse',
    'Johann Hösl-Gasse', 'Josef Glanner-Gasse', 'Josef Grüll-Gasse', 'Josef Stadlmann-Gasse', 'Josefsthal', 'Josefsthalerstraße',
    'Karl Richter-Gasse', 'Kirchengasse', 'Lederhasgasse', 'Lichteneckergasse', 'Mittelstraße', 'Mozartgasse',
    'Mühlfeldgasse', 'Mühlgasse', 'Neugasse', 'Prechtlgasse', 'Preyhsgasse', 'Probusgasse',
    'Rennbahnzeile', 'Rohrteichgasse', 'Rudolf Kaspar-Gasse', 'Schulgasse', 'Seeligerstraße', 'Spitzendorfergasse',
    'Stiftgasse', 'Traiskirchner Straße', 'Wiener Straße', 'Wüstegasse'
  ],
  streets2: [
    'Am Steinfeld', 'Einöde', 'Einödstraße', 'Franz Josef-Straße', 'Gmöslgasse', 'Haydngasse',
    'Schiestlgasse', 'Steinfeldgasse', 'Türkengasse'
  ]
};
