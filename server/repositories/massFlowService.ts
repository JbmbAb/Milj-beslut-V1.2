import {
  adjustMassVolume,
  listStorageAreasForProject,
  type StorageAreaContents,
} from '../repositories/storageAreaRepository';

interface MassFlowTransportBooking {
  projectId: string;
  wasteCode: string;
  sourceStorageAreaId?: string | null;
  destinationStorageAreaId?: string | null;
  volumeM3: number;
}

/**
 * Records the movement of mass between two storage areas based on a completed transport booking.
 * This function should be called when a transport booking status is updated to 'COMPLETED'.
 */
export async function recordMassMovement(booking: MassFlowTransportBooking): Promise<void> {
  if (!booking.volumeM3 || booking.volumeM3 <= 0) {
    // No volume to move, or invalid data.
    return;
  }

  const promises = [];

  // Remove mass from the source
  if (booking.sourceStorageAreaId) {
    promises.push(
      adjustMassVolume(booking.projectId, booking.sourceStorageAreaId, booking.wasteCode, -booking.volumeM3),
    );
  }

  // Add mass to the destination
  if (booking.destinationStorageAreaId) {
    promises.push(
      adjustMassVolume(
        booking.projectId,
        booking.destinationStorageAreaId,
        booking.wasteCode,
        booking.volumeM3,
      ),
    );
  }

  await Promise.all(promises);
}

/**
 * Generates a snapshot of the mass flow status for a project,
 * suitable for GIS-based visualization as described in the LiU exam paper.
 */
export async function getMassFlowSnapshot(projectId: string) {
  const areas = await listStorageAreasForProject(projectId);

  const snapshot = areas.map((area) => {
    const contents = (area.contents as StorageAreaContents | null) ?? {};
    const totalVolume = Object.values(contents).reduce((sum, vol) => sum + vol, 0);
    const fillPercentage = area.capacityM3 > 0 ? (totalVolume / area.capacityM3) * 100 : 0;

    return {
      id: area.id,
      name: area.name,
      geometry: area.geometry, // The GeoJSON polygon for the map
      capacityM3: area.capacityM3,
      currentVolumeM3: parseFloat(totalVolume.toFixed(2)),
      fillPercentage: parseFloat(fillPercentage.toFixed(1)),
      contents: Object.entries(contents).map(([wasteCode, volume]) => ({
        wasteCode,
        volumeM3: parseFloat(volume.toFixed(2)),
      })),
    };
  });

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    storageAreas: snapshot,
  };
}
