import React, { useRef, useEffect, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import OSM from 'ol/source/OSM';
import Draw from 'ol/interaction/Draw';
import { LineString, Polygon } from 'ol/geom';
import 'ol/ol.css';
import { transform } from 'ol/proj';
import { getDistance } from 'ol/sphere';
import './MapComponent.css';

const MapComponent = () => {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [drawType, setDrawType] = useState(null);
  const [waypoints, setWaypoints] = useState([]);
  const [showMissionModal, setShowMissionModal] = useState(false);
  const [showPolygonModal, setShowPolygonModal] = useState(false);
  const [distances, setDistances] = useState([]);
  const [initialModal, setInitialModal] = useState(false);
  const [insertPosition, setInsertPosition] = useState(null);
  const [insertType, setInsertType] = useState(null); // 'before' or 'after'
  const [tempPolygon, setTempPolygon] = useState(null);
  const [showDropdown, setShowDropdown] = useState(null);

  // Add dropdown menu component
  const CoordinateDropdown = ({ index }) => (
    <div className="coordinate-dropdown">
      <button onClick={() => setShowDropdown(index)}>⋮</button>
      {showDropdown === index && (
        <div className="dropdown-menu">
          <button onClick={() => handlePolygonInsert(index, 'before')}>
            Insert Polygon Before
          </button>
          <button onClick={() => handlePolygonInsert(index, 'after')}>
            Insert Polygon After
          </button>
        </div>
      )}
    </div>
  );

  // Add utility function to calculate distances
  const calculateDistances = (coords) => {
    return coords.map((coord, index) => {
      if (index === 0) return 0;
      const prev = coords[index - 1];
      const current = coord;
      // Convert to lon/lat for distance calculation
      const from = transform(prev, 'EPSG:3857', 'EPSG:4326');
      const to = transform(current, 'EPSG:3857', 'EPSG:4326');
      return Math.round(getDistance(from, to));
    });
  };

  // Add this utility function near other utility functions
  const calculatePolygonDistances = (coords) => {
    const distances = coords.map((coord, index) => {
      if (index === 0) return 0;
      const prev = coords[index - 1];
      const current = coord;
      return Math.round(getDistance(prev, current));
    });
    
    // Add distance from last point to first point to close the polygon
    distances.push(Math.round(getDistance(coords[coords.length - 1], coords[0])));
    return distances;
  };

  useEffect(() => {
    if (!mapRef.current) return;

    const vectorSource = new VectorSource();
    const vectorLayer = new VectorLayer({
      source: vectorSource
    });

    const map = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({
          source: new OSM()
        }),
        vectorLayer
      ],
      view: new View({
        center: [0, 0],
        zoom: 2
      })
    });

    mapInstanceRef.current = map;

    // Cleanup function to remove the map when the component unmounts
    return () => {
      map.setTarget(null);
      map.dispose();
    };
  }, []);

  const handleDrawOnMap = (type) => {
    setDrawType(type);
  };

  const handleStartDrawing = () => {
    if (!drawType) {
      alert('Please select a draw type first (Line or Polygon)');
      return;
    }
    setDrawing(true);
    setInitialModal(true);
  };

  const handleStopDrawing = () => {
    setDrawing(false);
  };

  // Handle polygon insertion
  const handlePolygonInsert = (index, type) => {
    setInsertPosition(index);
    setInsertType(type);
    setDrawType('Polygon');
    setDrawing(true);
    setShowDropdown(null);
    setShowMissionModal(false); // Hide mission modal while drawing
  };

  useEffect(() => {
    if (!drawing || !mapInstanceRef.current || !drawType) return;

    try {
      const draw = new Draw({
        source: mapInstanceRef.current.getLayers().getArray()[1].getSource(),
        type: drawType
      });

      mapInstanceRef.current.addInteraction(draw);

      const handleDrawEnd = (e) => {
        const feature = e.feature;
        const geometry = feature.getGeometry();
        const coordinates = geometry.getCoordinates();

        if (drawType === 'LineString') {
          const transformedCoords = coordinates.map(coord =>
            transform(coord, 'EPSG:3857', 'EPSG:4326')
          );

          setWaypoints(transformedCoords);
          setDistances(calculateDistances(coordinates));
          setShowMissionModal(true);
        } else if (drawType === 'Polygon') {
          const polygonCoords = coordinates[0] || [];
          const transformedCoords = polygonCoords.map(coord => {
            if (!coord || coord.length < 2) return null;
            const transformed = transform(coord, 'EPSG:3857', 'EPSG:4326');
            return transformed;
          }).filter(coord => coord !== null);

          if (insertPosition !== null) {
            setTempPolygon({
              coordinates: transformedCoords,
              position: insertPosition,
              type: insertType
            });
          } else {
            // Handle normal polygon drawing
            setTempPolygon({
              coordinates: transformedCoords,
              type: 'normal'
            });
          }
          setShowPolygonModal(true);
        }
        setDrawing(false);
        setInitialModal(false);
      };

      draw.on('drawend', handleDrawEnd);

      const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
          mapInstanceRef.current.removeInteraction(draw);
          setDrawing(false);
        }
      };

      document.addEventListener('keydown', handleKeyDown);

      return () => {
        mapInstanceRef.current.removeInteraction(draw);
        document.removeEventListener('keydown', handleKeyDown);
        draw.un('drawend', handleDrawEnd);
      };

    } catch (error) {
      console.error('Draw interaction error:', error);
      setDrawing(false);
    }
  }, [drawing, drawType, insertPosition, insertType]);

  const handleModalClose = () => {
    setShowMissionModal(false);
    setShowPolygonModal(false);
  };

  // Import polygon points
  const handleImportPolygon = () => {
    if (!tempPolygon) return;

    const newWaypoints = [...waypoints];
    let insertIndex = tempPolygon.type === 'after' 
      ? tempPolygon.position + 1 
      : tempPolygon.position;

    // Adjust insertIndex for existing polygon references
    for (let i = 0; i < insertIndex; i++) {
      if (typeof newWaypoints[i] === 'object' && newWaypoints[i].type === 'polygon') {
        insertIndex++;
      }
    }

    // Create polygon reference object with coordinates
    const polygonReference = {
      type: 'polygon',
      index: insertIndex,
      coordinates: tempPolygon.coordinates // Store the polygon coordinates
    };

    // Insert the polygon reference at the calculated index
    newWaypoints.splice(insertIndex, 0, polygonReference);

    setWaypoints(newWaypoints);
    setTempPolygon(null);
    setShowPolygonModal(false);
    setShowMissionModal(true); // Show mission modal after import
  };

return (
<div>
<div
ref={mapRef}
style={{
width: '100%',
height: '500px',
border: '1px solid black'
}}
/>
<button onClick={() => handleDrawOnMap('LineString')}>Draw Line</button>
<button onClick={() => handleDrawOnMap('Polygon')}>Draw Polygon</button>
<button onClick={handleStartDrawing}>Start Drawing</button>
<button onClick={handleStopDrawing}>Stop Drawing</button>

{initialModal && (
    <div className="modal">
        <div className="modal-content">
            <h2>Drawing Instructions</h2>
            <p>Click on the map to start drawing waypoints.</p>
            <p>Press Enter to complete the drawing.</p>
            <button onClick={() => setInitialModal(false)}>Got it</button>
        </div>
    </div>
)}

{/* Mission Modal */}
{showMissionModal && (
  <div className="modal">
    <div className="modal-content">
      <span className="close" onClick={handleModalClose}>&times;</span>
      <h2>Mission Waypoints</h2>
      <div className="scrollable-container">
        <table className="waypoints-table">
          <thead>
            <tr>
              <th>Waypoint</th>
              <th>Coordinates</th>
              <th>Distance (m)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {waypoints.map((waypoint, index) => (
              <tr key={index}>
                <td>
                  {waypoint.type === 'polygon' 
                    ? `Polygon Ref (${waypoint.index})`
                    : `WP(${String(index).padStart(2, '0')})`
                  }
                </td>
                <td>
                  {waypoint.type === 'polygon' ? (
                    <button onClick={() => {
                      if (waypoint.coordinates) {
                        setTempPolygon({
                          coordinates: waypoint.coordinates,
                          position: index,
                          type: 'view'
                        });
                        setShowPolygonModal(true);
                      }
                    }}>
                      View Polygon
                    </button>
                  ) : (
                    `${waypoint[0].toFixed(6)}°, ${waypoint[1].toFixed(6)}°`
                  )}
                </td>
                <td>
                  {index > 0 && !waypoint.type && distances[index]}
                </td>
                <td>
                  {!waypoint.type && (
                    <div className="coordinate-dropdown">
                      <button onClick={() => setShowDropdown(index)}>⋮</button>
                      {showDropdown === index && (
                        <div className="dropdown-menu">
                          <button onClick={() => handlePolygonInsert(index, 'before')}>
                            Insert Polygon Before
                          </button>
                          <button onClick={() => handlePolygonInsert(index, 'after')}>
                            Insert Polygon After
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </div>
)}

{/* Polygon Modal */}
{showPolygonModal && (
    <div className="modal">
        <div className="modal-content">
            <span className="close" onClick={handleModalClose}>&times;</span>
            <h2>Polygon Coordinates</h2>
            {tempPolygon && (
                <div>
                    {(tempPolygon.type === 'before' || tempPolygon.type === 'after') && (
                        <button 
                            onClick={handleImportPolygon}
                            className="import-button"
                        >
                            Import Points
                        </button>
                    )}
                    <div className="polygon-coordinates">
                        <table>
                            <thead>
                                <tr>
                                    <th>Point</th>
                                    <th>Latitude</th>
                                    <th>Longitude</th>
                                    <th>Distance to Next (m)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tempPolygon.coordinates.map((coord, index) => {
                                    const distances = calculatePolygonDistances(tempPolygon.coordinates);
                                    return (
                                        <tr key={index}>
                                            <td>P{index + 1}</td>
                                            <td>{coord[1].toFixed(6)}°</td>
                                            <td>{coord[0].toFixed(6)}°</td>
                                            <td>{distances[index]}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    </div>
)}
</div>
);
};
export default MapComponent;