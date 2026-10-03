import { getEdithPersistenceStore } from '../../src/edith/persistence';
import { MobileCryptoService } from './crypto';
import { MobilePairingService } from './pairingService';
import { MobileRealtimeService } from './realtime';
import { MobileRegistryStore } from './registryStore';
import { MobileTransferService } from './transferService';
import { onOwnerSessionInvalidated } from '../security/ownerSession';
import { CrossDeviceService } from './crossDeviceService';

export interface MobileRuntime {
  store: MobileRegistryStore;
  crypto: MobileCryptoService;
  pairing: MobilePairingService;
  realtime: MobileRealtimeService;
  transfers: MobileTransferService;
  crossDevice: CrossDeviceService;
}

let runtime: MobileRuntime | undefined;

export function getMobileRuntime(): MobileRuntime {
  if (runtime) return runtime;
  const dataDir = getEdithPersistenceStore().getPaths().dataDir;
  const store = new MobileRegistryStore(dataDir);
  store.initialize();
  const crypto = new MobileCryptoService();
  const pairing = new MobilePairingService(store, crypto);
  const realtime = new MobileRealtimeService(pairing, crypto, store.serverId());
  const crossDevice = new CrossDeviceService(store.serverId());
  runtime = { store, crypto, pairing, realtime, transfers: new MobileTransferService(store, dataDir), crossDevice };
  onOwnerSessionInvalidated((event) => {
    crossDevice.invalidateOwnerBinding(event.bindingId);
    for (const deviceId of pairing.revokeOwnerBinding(event.bindingId)) realtime.disconnectDevice(deviceId);
  });
  return runtime;
}
