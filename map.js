// Initialize the map centered on Havana, Cuba
const map = L.map("map").setView([23.1136, -82.3666], 13);

// Add a Mapbox Tile Layer
L.tileLayer("https://api.mapbox.com/styles/v1/mapbox/light-v11/tiles/{z}/{x}/{y}?access_token={accessToken}", {
    id: "mapbox/streets-v11", // Use the desired Mapbox style (see below for options)
    accessToken: "pk.eyJ1IjoiY2FzY3V0ZSIsImEiOiJjbTY2N2pvemExZXJuMmlzZWR3YjY1NHFnIn0.pyrfT0eTSoUhe7Bnbdh7kA",
    tileSize: 512, // Required for Mapbox tiles
    zoomOffset: -1, // Required for Mapbox tiles
    attribution: '© <a href="https://www.mapbox.com/">Mapbox</a> contributors'
}).addTo(map);

// Fetch and display GeoJSON data
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

// Add the Leaflet Draw control to the map
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

// Event listener to capture the drawn rectangle's bounds
let bounds = null;
map.on(L.Draw.Event.CREATED, (event) => {
    const layer = event.layer;
    map.addLayer(layer);
    bounds = layer.getBounds();  // Store the selected bounds
    console.log("Selected bounds:", bounds.toBBoxString());
});

// Button to send the selected bounds to the Flask backend
document.addEventListener("DOMContentLoaded", function () {
    const downloadBtn = document.getElementById("download-btn");
    if (downloadBtn) {
        downloadBtn.addEventListener("click", async () => {
            if (!bounds) {
                alert("Please draw a rectangle on the map.");
                return;
            }

            // Convert bounds to bounding box format
            const bbox = [
                bounds.getSouth(),
                bounds.getWest(),
                bounds.getNorth(),
                bounds.getEast(),
            ];

            // Send the bounding box to the Flask backend
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

// Event listener for the "Load Processed Data" button
document.addEventListener("DOMContentLoaded", function () {
    const loadGeoJsonBtn = document.getElementById("load-geojson-btn");

    if (loadGeoJsonBtn) {
        loadGeoJsonBtn.addEventListener("click", async () => {
            // Remove the existing GeoJSON layer if it exists
            if (window.geojsonLayer) {
                map.removeLayer(window.geojsonLayer);
            }

            try {
                // Fetch the GeoJSON data from the server
                const response = await fetch("/get-geojson");
                if (!response.ok) {
                    throw new Error("GeoJSON data cannot be loaded");
                }

                const geojsonData = await response.json();

                // Add the new GeoJSON layer with updated popups and colors
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

                // Add the new layer to the map
                window.geojsonLayer.addTo(map);

                // Adjust the map to fit the new markers
                map.fitBounds(window.geojsonLayer.getBounds());

                // Trigger popups to show automatically
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


// Event listener for the "Clear All Data" button
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

                        // Remove all layers from the map except the base tile layer
                        map.eachLayer((layer) => {
                            if (layer !== map._layers[Object.keys(map._layers)[0]]) {
                                map.removeLayer(layer);
                            }
                        });

                        // Reset the map view to the initial state
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
