from flask import Flask, request, jsonify, send_file, render_template, abort, Response
import requests
import os
import zipfile
import sqlite3
from datetime import datetime
import json
from PIL import Image
import io
from ultralytics import YOLO
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

app = Flask(__name__)

MAPILLARY_ACCESS_TOKEN = "MLY|8910876029008890|ee77fbe8f16e34a5d85503159d9eeb91"

STATIC_DIR = os.path.join(os.getcwd(), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

DB_PATH = os.path.join(STATIC_DIR, "mapillary_data_geojson.db")
GEOJSON_PATH = os.path.join(STATIC_DIR, "mapillary_data.geojson")

YOLO_MODEL_PATH = "./train17_100epochs/weights/best.pt"
model = YOLO(YOLO_MODEL_PATH)

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS mapillary_data_geojson
                 (id TEXT PRIMARY KEY, 
                  latitude REAL,
                  longitude REAL,
                  captured_at TEXT,
                  sequence_id TEXT,
                  json_data TEXT,
                  image_1024 BLOB,
                  image_classified BLOB,
                  json_classified TEXT)
             ''')
    conn.commit()
    conn.close()

init_db()

def process_image_with_yolo(image_blob):
    image = Image.open(io.BytesIO(image_blob))
    results = model.predict(source=image, save=False, conf=0.25)

    processed_image = results[0].plot()
    image_bytes = io.BytesIO()
    Image.fromarray(processed_image).save(image_bytes, format='JPEG')

    classification_result = {"details": results[0].to_json()}
    return image_bytes.getvalue(), classification_result

def store_location(image_data):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    fields = [
        'id', 'altitude', 'atomic_scale', 'camera_parameters', 'camera_type',
        'captured_at', 'compass_angle', 'computed_altitude', 'computed_compass_angle',
        'computed_geometry', 'computed_rotation', 'creator', 'exif_orientation',
        'geometry', 'height', 'is_pano', 'make', 'model', 'thumb_256_url',
        'thumb_1024_url', 'thumb_2048_url', 'thumb_original_url', 'merge_cc',
        'mesh', 'sequence', 'sfm_cluster', 'width', 'detections'
    ]
    
    detail_url = f"https://graph.mapillary.com/{image_data['id']}?access_token={MAPILLARY_ACCESS_TOKEN}&fields={','.join(fields)}"
    detail_response = requests.get(detail_url)
    json_data = detail_response.json() if detail_response.status_code == 200 else None
    
    if json_data and 'thumb_1024_url' in json_data:
        print(f"Downloading 1024px thumbnail for {image_data['id']}")
        thumb_response = requests.get(json_data['thumb_1024_url'])
        image_1024 = thumb_response.content if thumb_response.status_code == 200 else None
    else:
        image_1024 = None

    if image_1024:
        image_classified, json_classified = process_image_with_yolo(image_1024)
    else:
        image_classified, json_classified = None, None

    captured_at = json_data.get('captured_at', None) if json_data else None
    if captured_at:
        captured_at = datetime.utcfromtimestamp(captured_at / 1000).strftime('%Y-%m-%d %H:%M:%S')

    sequence_id = ''
    if json_data and 'sequence' in json_data:
        sequence_id = json_data['sequence']['id'] if isinstance(json_data['sequence'], dict) else json_data['sequence']


    c.execute('''INSERT OR REPLACE INTO mapillary_data_geojson 
                (id, latitude, longitude, captured_at, sequence_id, json_data, image_1024, image_classified, json_classified) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                 (image_data['id'],
                  image_data['geometry']['coordinates'][1],
                  image_data['geometry']['coordinates'][0],
                  captured_at,
                  sequence_id,
                  json.dumps(json_data),
                  image_1024,
                  image_classified,
                  json.dumps(json_classified)
                 )
    )
    conn.commit()
    conn.close()

def db_to_geojson(db_path, geojson_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM mapillary_data_geojson")
    rows = cursor.fetchall()

    column_names = [description[0] for description in cursor.description]

    geojson = {
        "type": "FeatureCollection",
        "features": []
    }

    for row in rows:
        row_dict = dict(zip(column_names, row))

        json_classified = json.loads(row_dict["json_classified"]) if row_dict["json_classified"] else None
        json_data = json.loads(row_dict["json_data"]) if row_dict.get("json_data") else None

        if json_classified and isinstance(json_classified.get("details"), str):
            try:
                json_classified["details"] = json.loads(json_classified["details"])
            except json.JSONDecodeError:
                json_classified["details"] = []

        feature = {
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [row_dict["longitude"], row_dict["latitude"]]
            },
            "properties": {
                "id": row_dict["id"],
                "captured_at": row_dict["captured_at"],
                "sequence_id": row_dict["sequence_id"],
                "json_classified": json_classified,
                "thumb_1024_url": json_data.get("thumb_1024_url") if json_data else None
            }
        }
        geojson["features"].append(feature)

    directory = os.path.dirname(os.path.abspath(geojson_path))
    os.makedirs(directory, exist_ok=True)

    with open(geojson_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, indent=2)

    conn.close()
    print(f"GeoJSON saved to {geojson_path}")

def analyze_classifications():
    with open("classification_summary.txt", "w") as f:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        cursor.execute("SELECT json_classified FROM mapillary_data_geojson WHERE json_classified IS NOT NULL")
        rows = cursor.fetchall()

        f.write(f"Total rows to analyze: {len(rows)}\n")

        damaged_count = 0
        undamaged_count = 0

        for row in rows:
            json_data = json.loads(row[0])
            detections = json_data.get("details", {}).get("detections", [])

            f.write(f"Processing image with detections: {detections}\n")

            damaged = any(detection.get("class") == "damaged_window" for detection in detections)
            undamaged = all(detection.get("class") == "undamaged_window" for detection in detections)

            if damaged:
                damaged_count += 1
            elif undamaged or not detections:
                undamaged_count += 1

        f.write(f"Images with at least one damaged window: {damaged_count}\n")
        f.write(f"Images with no windows or only undamaged windows: {undamaged_count}\n")

        conn.close()

@app.route("/get-image/<image_id>")
def get_image(image_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("SELECT image_1024 FROM mapillary_data_geojson WHERE id = ?", (image_id,))
    result = c.fetchone()
    conn.close()
    
    if result and result[0]:
        return send_file(
            io.BytesIO(result[0]),
            mimetype='image/jpeg',
            as_attachment=True,
            download_name=f'mapillary_{image_id}.jpg'
        )
    return jsonify({"error": "Image not found"}), 404

@app.route("/")
def index():
    return render_template('index.html')

@app.route("/download-images", methods=["POST"])
def download_images():
    data = request.json
    if not data or "bounds" not in data:
        return jsonify({"error": "Invalid data"}), 400

    bounds = data["bounds"]
    south, west, north, east = bounds
    url = f"https://graph.mapillary.com/images?access_token={MAPILLARY_ACCESS_TOKEN}&bbox={west},{south},{east},{north}"

    response = requests.get(url)
    if response.status_code != 200:
        return jsonify({"error": "Failed to fetch images from Mapillary"}), 500

    images = response.json().get("data", [])
    if not images:
        return jsonify({"message": "No images found"}), 404

    os.makedirs("downloads", exist_ok=True)
    zip_path = "downloads/images.zip"
    with zipfile.ZipFile(zip_path, "w") as zipf:
        for image in images:
            image_id = image["id"]
            image_url = f"https://graph.mapillary.com/{image_id}?access_token={MAPILLARY_ACCESS_TOKEN}"
            img_response = requests.get(image_url, stream=True)
            if img_response.status_code == 200:
                file_path = f"downloads/{image_id}.jpg"
                with open(file_path, "wb") as f:
                    f.write(img_response.content)
                zipf.write(file_path, arcname=f"{image_id}.jpg")
                os.remove(file_path)

    return send_file(zip_path, as_attachment=True)

@app.route("/fetch-area", methods=["POST"])
def fetch_area():
    data = request.json
    bounds = data["bounds"]
    south, west, north, east = bounds
    
    per_page = 1000
    has_more = True
    after = None
    total_images = 0

    while has_more:
        url = f"https://graph.mapillary.com/images?access_token={MAPILLARY_ACCESS_TOKEN}&bbox={west},{south},{east},{north}&per_page={per_page}"
        if after:
            url += f"&after={after}"

        response = requests.get(url)
        if response.status_code != 200:
            break

        result = response.json()
        images = result.get("data", [])
        
        for image in images:
            store_location(image)
            total_images += 1

        if "next" in result.get("paging", {}):
            after = result["paging"]["cursors"]["after"]
        else:
            has_more = False

    db_to_geojson(DB_PATH, GEOJSON_PATH)

    return jsonify({
        "message": f"Successfully processed {total_images} images and exported to GEOJSON",
        "total_images": total_images
    })

@app.route("/get-locations", methods=["GET"])
def get_locations():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT * FROM mapillary_data_geojson")
    locations = [{"id": row[0],
                 "latitude": row[1],
                 "longitude": row[2],
                 "captured_at": row[3],
                 "sequence_id": row[4],
                 "image_url": row[5]} for row in c.fetchall()]
    conn.close()
    return jsonify(locations)

@app.route("/export-images", methods=["GET"])
def export_images():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT id, image_1024 FROM mapillary_data_geojson WHERE image_1024 IS NOT NULL")
    rows = c.fetchall()
    
    output_dir = "exported_images"
    os.makedirs(output_dir, exist_ok=True)
    
    exported_count = 0
    for row in rows:
        image_id, image_blob = row
        if image_blob:
            image = Image.open(io.BytesIO(image_blob))
            output_path = os.path.join(output_dir, f"{image_id}.png")
            image.save(output_path, "PNG")
            exported_count += 1
    
    conn.close()
    return jsonify({
        "message": f"Successfully exported {exported_count} images to PNG format",
        "export_path": output_dir
    })

@app.route("/export-classified-images", methods=["GET"])
def export_images_classified():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT id, image_classified FROM mapillary_data_geojson WHERE image_classified is not NULL")
    rows = c.fetchall()
    
    output_dir = "exported_images_classified"
    os.makedirs(output_dir, exist_ok=True)
     
    exported_count = 0
    for row in rows:
        image_id, image_blob = row
        if image_blob:
            image = Image.open(io.BytesIO(image_blob))
            output_path = os.path.join(output_dir, f"{image_id}.png")
            image.save(output_path, "PNG")
            exported_count += 1

    conn.close()
    return jsonify({
        "message": f"Successfully exported {exported_count} classified images to PNG format",
        "export_path": output_dir
    })

@app.route("/get-geojson", methods=["GET"])
def get_geojson():
    if not os.path.exists(GEOJSON_PATH):
        return jsonify({"error": "GeoJSON file not found."}), 404

    return send_file(GEOJSON_PATH, mimetype="application/json")

@app.route("/process-images", methods=["GET"])
def process_images():

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute('SELECT id, image_1024 FROM mapillary_data_geojson WHERE image_1024 IS NOT NULL AND image_classified IS NULL')
    rows = c.fetchall()

    for location_id, image_blob in rows:
        image = Image.open(io.BytesIO(image_blob))
        results = model.predict(source=image, save=False, conf=0.25)
        processed_image = results[0].plot()
        image_bytes = io.BytesIO()
        Image.fromarray(processed_image).save(image_bytes, format='JPEG')

        classification_result = {"details": results[0].to_json()}
        c.execute('UPDATE mapillary_data_geojson SET image_classified=?, json_classified=? WHERE id=?',
                  (image_bytes.getvalue(), json.dumps(classification_result), location_id))

    conn.commit()
    conn.close()

    db_to_geojson(DB_PATH, GEOJSON_PATH)
    
    results = analyze_classifications()

    return jsonify({
        "message": "Image processing completed and exported to GEOJSON",
        "classification_summary": results
    })

@app.route("/get-image-classified/<image_id>")
def get_image_classified(image_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("SELECT image_classified FROM mapillary_data_geojson WHERE id = ?", (image_id,))
    result = c.fetchone()
    conn.close()

    if result and result[0]:
        return send_file(
            io.BytesIO(result[0]),
            mimetype='image/jpeg',
            as_attachment=False
        )
    return jsonify({"error": "Classified image not found"}), 404

@app.route("/clear-data", methods=["POST"])
def clear_data():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("DELETE FROM mapillary_data_geojson")
    conn.commit()
    conn.close()

    if os.path.exists(GEOJSON_PATH):
        os.remove(GEOJSON_PATH)

    return jsonify({"message": "All data cleared successfully."})

if __name__ == "__main__":
    init_db()
    app.run(debug=True, host='127.0.0.5', port=5000)
