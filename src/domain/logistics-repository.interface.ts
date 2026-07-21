import { TransportBooking, StorageArea, GpsPosition } from './logistics';

export interface ILogisticsRepository {
  saveBooking(booking: TransportBooking): Promise<TransportBooking>;
  findBookingsByProject(projectId: string): Promise<TransportBooking[]>;
  saveStorageArea(area: StorageArea): Promise<StorageArea>;
  findStorageAreasByProject(projectId: string): Promise<StorageArea[]>;

  // GPS Tracking
  addGpsPosition(position: GpsPosition): Promise<GpsPosition>;
  getGpsTrack(bookingId: string): Promise<GpsPosition[]>;
  getLatestPosition(bookingId: string): Promise<GpsPosition | null>;
  clearGpsTrack(bookingId: string): Promise<void>;
}
