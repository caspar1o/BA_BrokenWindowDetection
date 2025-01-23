const map = L.map("map").setView([23.1136, -82.3666], 13);

L.tileLayer("https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/{z}/{x}/{y}?access_token={accessToken}", {
    id: "mapbox/streets-v11", 
    accessToken: "mapbox_access_token",
    tileSize: 512, 
    zoomOffset: -1, 
    attribution: '© <a href="https://www.mapbox.com/">Mapbox</a> contributors'
}).addTo(map);

fetch("/static/mapillary_data.geojson")
    .then(response => response.json())
    .then(geojsonData => {
        if (window.geojsonLayer) {
            map.removeLayer(window.geojsonLayer);
        }

        window.geojsonLayer = L.geoJSON(geojsonData, {
            pointToLayer: function (feature, latlng) {
                let isDamaged = false;

                if (feature.properties.json_classified && Array.isArray(feature.properties.json_classified.details)) {
                    isDamaged = feature.properties.json_classified.details.some(d => d.name === "windows_damaged");
                }

                const markerOptions = {
                    radius: 6,
                    fillColor: isDamaged ? "#BB3E27" : "#617A7C",
                    color: "#000",
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                };

                return L.circleMarker(latlng, markerOptions);
            },
            onEachFeature: function (feature, layer) {
                let popupContent = `<b>ID:</b> ${feature.properties.id || 'N/A'}<br>
                                    <b>Captured At:</b> ${feature.properties.captured_at || 'N/A'}<br>
                                    <b>Sequence ID:</b> ${feature.properties.sequence_id || 'N/A'}`;

                if (feature.properties.thumb_1024_url) {
                    popupContent += `<br><b>Original Image:</b><br>
                                     <img src="${feature.properties.thumb_1024_url}" alt="Original Image" style="width: 200px; height: auto;">`;
                }

                if (feature.properties.id) {
                    const classifiedImageUrl = `/get-image-classified/${feature.properties.id}`;
                    popupContent += `<br><b>Classified Image:</b><br>
                                     <img src="${classifiedImageUrl}" alt="Classified Image" style="width: 200px; height: auto;">`;
                }

                layer.bindPopup(popupContent);
            }
        });

        window.geojsonLayer.addTo(map);
        map.fitBounds(window.geojsonLayer.getBounds());
    })
    .catch(error => {
        console.error("Error loading GeoJSON:", error);
    });

const drawControl = new L.Control.Draw({
    draw: {
        polyline: false,
        polygon: true,
        circle: false,
        marker: false,
        circlemarker: false,
        rectangle: true, 
    },
    edit: false
});
map.addControl(drawControl);

let bounds = null;
map.on(L.Draw.Event.CREATED, (event) => {
    const layer = event.layer;
    map.addLayer(layer);
    bounds = layer.getBounds();  
    console.log("Selected bounds:", bounds.toBBoxString());
});

document.addEventListener("DOMContentLoaded", function () {
    const downloadBtn = document.getElementById("download-btn");
    if (downloadBtn) {
        downloadBtn.addEventListener("click", async () => {
            if (!bounds) {
                alert("Please draw a rectangle on the map.");
                return;
            }

            const bbox = [
                bounds.getSouth(),
                bounds.getWest(),
                bounds.getNorth(),
                bounds.getEast(),
            ];

            try {
                const response = await fetch("/fetch-area", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ bounds: bbox }),
                });

                if (response.ok) {
                    const result = await response.json();
                    alert(result.message);
                } else {
                    alert("Error fetching images.");
                }
            } catch (error) {
                console.error(error);
                alert("Failed to download images.");
            }
        });
    }
});

document.addEventListener("DOMContentLoaded", function () {
    const loadGeoJsonBtn = document.getElementById("load-geojson-btn");

    if (loadGeoJsonBtn) {
        loadGeoJsonBtn.addEventListener("click", async () => {
            if (window.geojsonLayer) {
                map.removeLayer(window.geojsonLayer);
            }

            try {
                const response = await fetch("/get-geojson");
                if (!response.ok) {
                    throw new Error("GeoJSON data cannot be loaded");
                }

                const geojsonData = await response.json();

                window.geojsonLayer = L.geoJSON(geojsonData, {
                    pointToLayer: function (feature, latlng) {
                        let isDamaged = false;

                        if (feature.properties.json_classified && Array.isArray(feature.properties.json_classified.details)) {
                            isDamaged = feature.properties.json_classified.details.some(d => d.name === "windows_damaged");
                        }

                        const markerOptions = {
                            radius: 6,
                            fillColor: isDamaged ? "#BB3E27" : "#617A7C",
                            color: "#000",
                            weight: 1,
                            opacity: 1,
                            fillOpacity: 0.8
                        };

                        return L.circleMarker(latlng, markerOptions);
                    },
                    onEachFeature: function (feature, layer) {
                        let popupContent = `<b>ID:</b> ${feature.properties.id || 'N/A'}<br>
                                            <b>Captured At:</b> ${feature.properties.captured_at || 'N/A'}<br>
                                            <b>Sequence ID:</b> ${feature.properties.sequence_id || 'N/A'}`;

                        if (feature.properties.thumb_1024_url) {
                            popupContent += `<br><b>Original Image:</b><br>
                                             <img src="${feature.properties.thumb_1024_url}" alt="Original Image" style="width: 200px; height: auto;">`;
                        }

                        if (feature.properties.id) {
                            const classifiedImageUrl = `/get-image-classified/${feature.properties.id}`;
                            popupContent += `<br><b>Classified Image:</b><br>
                                             <img src="${classifiedImageUrl}" alt="Classified Image" style="width: 200px; height: auto;">`;
                        }

                        layer.bindPopup(popupContent);
                    }
                });

                window.geojsonLayer.addTo(map);

                map.fitBounds(window.geojsonLayer.getBounds());

                map.eachLayer(layer => {
                    if (layer instanceof L.CircleMarker) {
                        layer.openPopup();
                    }
                });
            } catch (error) {
                console.error("Error loading GeoJSON:", error);
                alert("GeoJSON data cannot be loaded.");
            }
        });
    }
});

document.addEventListener("DOMContentLoaded", function () {
    const clearDataBtn = document.getElementById("clear-data-btn");
    if (clearDataBtn) {
        clearDataBtn.addEventListener("click", async () => {
            if (confirm("Are you sure you want to clear all data? This action cannot be undone.")) {
                try {
                    const response = await fetch("/clear-data", {
                        method: "POST"
                    });

                    if (response.ok) {
                        const result = await response.json();
                        alert(result.message);

                        map.eachLayer((layer) => {
                            if (layer !== map._layers[Object.keys(map._layers)[0]]) {
                                map.removeLayer(layer);
                            }
                        });

                        map.setView([23.1136, -82.3666], 13);
                    } else {
                        alert("Error clearing data.");
                    }
                } catch (error) {
                    console.error("Error clearing data:", error);
                    alert("Failed to clear data.");
                }
            }
        });
    }
});
