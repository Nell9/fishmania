#!/usr/bin/env python3
"""КлёвГид — сборка базы знаний SQLite из seed/fishdb.json.

Создаёт klevgid.db с таблицами:
  species          — вид, латынь, экология, температурные рамки, месяцы, карточка
  waters_affinity  — пригодность вида к типу водоёма (0..1)
  region_presence  — широтный ареал (lat_min..lat_max)
  baits            — насадки и базовая привлекательность
  behavior         — факторные научные правила (корпус для RAG)
  sources          — источники

Запуск:  python build_db.py   (рядом появится klevgid.db)
Путь к БД можно переопределить переменной окружения KLEVGID_DB.
"""
import json, os, sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))
SEED = os.path.join(HERE, "seed", "fishdb.json")
DB = os.environ.get("KLEVGID_DB", os.path.join(HERE, "klevgid.db"))

SCHEMA = """
DROP TABLE IF EXISTS species;
DROP TABLE IF EXISTS waters_affinity;
DROP TABLE IF EXISTS region_presence;
DROP TABLE IF EXISTS baits;
DROP TABLE IF EXISTS behavior;
DROP TABLE IF EXISTS sources;

CREATE TABLE species (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, latin TEXT,
  o2 TEXT, flow TEXT, river_link REAL,
  spawn_temp_lo REAL, spawn_temp_hi REAL,
  clarity TEXT, predator INTEGER, gregarious INTEGER, stocked INTEGER,
  max_len_cm INTEGER,
  temp_lo REAL, temp_comf_lo REAL, temp_comf_hi REAL, temp_hi REAL,
  shallow REAL, mid REAL, deep REAL, months TEXT, raw TEXT,
  knowledge TEXT
);
CREATE TABLE waters_affinity (species_id TEXT, water_type TEXT, affinity REAL,
  PRIMARY KEY (species_id, water_type));
CREATE TABLE region_presence (species_id TEXT PRIMARY KEY, lat_min REAL, lat_max REAL);
CREATE TABLE baits (species_id TEXT, bait TEXT, base REAL, PRIMARY KEY (species_id, bait));
CREATE TABLE behavior (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  species_id TEXT, factor TEXT, rule TEXT, weight REAL, source_id INTEGER
);
CREATE TABLE sources (id INTEGER PRIMARY KEY, ref TEXT);

CREATE INDEX ix_beh_species ON behavior(species_id);
CREATE INDEX ix_beh_factor ON behavior(factor);
CREATE INDEX ix_wa_type ON waters_affinity(water_type);
"""

O2_TXT = {
    "high": "Требователен к кислороду — нужна чистая, проточная или прохладная вода; в малом заморном пруду редок.",
    "med": "Умеренные требования к кислороду — переносит типичные озёрно-речные условия.",
    "low": "Стоек к дефициту кислорода — выживает в стоячих, заморных, заиленных прудах.",
}
FLOW_TXT = {
    "rheo": "Реофил: держится на течении — перекаты, струи, входы и выходы из ям.",
    "eury": "Эвритоп: встречается и на течении, и в стоячей воде.",
    "limno": "Лимнофил: предпочитает стоячую и слабопроточную воду, заливы, заросли.",
}
MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь",
          "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"]
PERIOD = {"dawn": "утренняя зорька", "day": "день", "dusk": "вечерняя зорька", "night": "ночь"}
WATER_NAME = {}


def behavior_rows(fid, f, e):
    rows = []
    t = f.get("temp", [None] * 4)
    sp = e.get("spawnTemp", [None, None])
    rows.append(("temperature",
        f"Комфортная температура воды {t[1]}–{t[2]} °C (активен {t[0]}–{t[3]} °C); "
        f"нерест при {sp[0]}–{sp[1]} °C.", 1.0, 1))
    rows.append(("oxygen", O2_TXT.get(e.get("o2"), ""), 0.8, 2))
    rows.append(("flow", FLOW_TXT.get(e.get("flow"), ""), 0.8, 2))
    rl = e.get("riverLink", 0)
    if rl >= 0.6:
        rows.append(("connectivity",
            "Сильно связан с речной системой — в изолированных прудах без связи с рекой почти не встречается.", 0.9, 2))
    elif rl <= 0.2:
        rows.append(("connectivity",
            "Типичный обитатель изолированных прудов и стариц; в реке с сильным течением редок.", 0.7, 2))
    if e.get("predator"):
        rows.append(("feeding",
            "Хищник: засадой или активным поиском атакует малька и искусственные приманки (джиг, воблер, блёсны, живец).", 1.0, 3))
    else:
        rows.append(("feeding",
            "Мирная рыба: кормится донным кормом, растительностью и насадками (черв, опарыш, мотыль, растительные).", 1.0, 3))
    times = f.get("times", {})
    best = [PERIOD[k] for k, v in times.items() if v >= 0.8]
    if best:
        rows.append(("daytime", "Пик активности: " + ", ".join(best) + ".", 0.9, 1))
    months = f.get("months", [])
    act = [MONTHS[i] for i, v in enumerate(months) if v >= 0.6]
    if act:
        rows.append(("season", "Активный клёв (для средней полосы): " + ", ".join(act) + ".", 0.8, 1))
    rows.append(("size",
        f"Максимальная длина ~{e.get('maxLenCm')} см; "
        + ("крупная/хищная рыба — снасть прочнее." if e.get("maxLenCm", 0) >= 70 else "некрупная рыба — деликатная снасть."),
        0.5, 1))
    if e.get("stocked"):
        rows.append(("stocking",
            "Объект зарыбления: в естественных условиях средней полосы встречается только там, где водоём зарыбляют.", 0.8, 4))
    return [(fid,) + r for r in rows if r[1]]


def main():
    data = json.load(open(SEED, encoding="utf-8"))
    FISHES, ECOLOGY, KNOWLEDGE, SOURCES, WATERS = (
        data["FISHES"], data["ECOLOGY"], data["KNOWLEDGE"], data["SOURCES"], data["WATERS"])
    for k, v in WATERS.items():
        WATER_NAME[k] = v.get("name", k)

    db = sqlite3.connect(DB)
    db.executescript(SCHEMA)

    for i, ref in enumerate(SOURCES, start=1):
        db.execute("INSERT INTO sources(id, ref) VALUES (?,?)", (i, ref))

    for fid, f in FISHES.items():
        e = ECOLOGY.get(fid, {})
        t = f.get("temp", [None] * 4)
        d = f.get("depth", {})
        db.execute(
            """INSERT INTO species(id,name,latin,o2,flow,river_link,spawn_temp_lo,spawn_temp_hi,
                 clarity,predator,gregarious,stocked,max_len_cm,temp_lo,temp_comf_lo,temp_comf_hi,temp_hi,
                 shallow,mid,deep,months,raw,knowledge)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (fid, f.get("name"), f.get("latin"), e.get("o2"), e.get("flow"), e.get("riverLink"),
             (e.get("spawnTemp") or [None, None])[0], (e.get("spawnTemp") or [None, None])[1],
             e.get("clarity"), int(bool(e.get("predator"))), int(bool(e.get("gregarious"))),
             int(bool(e.get("stocked"))), e.get("maxLenCm"),
             t[0], t[1], t[2], t[3], d.get("shallow"), d.get("mid"), d.get("deep"),
             json.dumps(f.get("months")), json.dumps(f, ensure_ascii=False), KNOWLEDGE.get(fid, "")))
        for wt, aff in (f.get("waters") or {}).items():
            db.execute("INSERT INTO waters_affinity(species_id,water_type,affinity) VALUES (?,?,?)",
                       (fid, wt, aff))
        lat = f.get("lat") or [None, None]
        db.execute("INSERT INTO region_presence(species_id,lat_min,lat_max) VALUES (?,?,?)",
                   (fid, lat[0], lat[1]))
        for b, base in (f.get("baits") or {}).items():
            db.execute("INSERT INTO baits(species_id,bait,base) VALUES (?,?,?)", (fid, b, base))
        for row in behavior_rows(fid, f, e):
            db.execute("INSERT INTO behavior(species_id,factor,rule,weight,source_id) VALUES (?,?,?,?,?)", row)

    db.commit()
    n = lambda q: db.execute(q).fetchone()[0]
    print(f"DB built: {DB}")
    print(f"  species={n('SELECT COUNT(*) FROM species')} "
          f"waters_affinity={n('SELECT COUNT(*) FROM waters_affinity')} "
          f"behavior={n('SELECT COUNT(*) FROM behavior')} "
          f"baits={n('SELECT COUNT(*) FROM baits')} "
          f"sources={n('SELECT COUNT(*) FROM sources')}")
    db.close()


if __name__ == "__main__":
    main()
