import { getEdithPersistenceStore } from '../../src/edith/persistence';
import { MobileCryptoService } from './crypto';
import { MobilePairingService } from './pairingService';
import { MobileRealtimeService } from './realtime';
import { MobileRegistryStore } from './registryStore';
import { MobileTransferService } from './transferService';
import { onOwnerSessionInvalidated } from '../security/ownerSession';
import { CrossDeviceService } from './crossDeviceService';
import { DesktopProducerService, sharedDesktopProducerService } from './desktopProducerService';
import { onKillSwitchActivated } from '../../src/edith/killSwitch';

export interface MobileRuntime {
  store: MobileRegistryStore;
  crypto: MobileCryptoService;
  pairing: MobilePairingService;
  realtime: MobileRealtimeService;
  transfers: MobileTransferService;
  crossDevice: CrossDeviceService;
  desktopProducer?: DesktopProducerService;
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
  const transfers=new MobileTransferService(store,dataDir,id=>crypto.sessionKeyFingerprint(id),context=>{pairing.revalidateContext(context);});
  crossDevice.setTransferAuthority(transfers);
  pairing.onSessionReplaced((deviceId,priorSessionId) => {
    transfers.invalidateSession(deviceId,priorSessionId);
    sharedDesktopProducerService.revokeSession(deviceId,priorSessionId);
    const device = store.getDevice(deviceId);
    if (device) crossDevice.invalidateOwnerBinding(device.ownerBinding.ownerSessionId);
  });
  runtime = { store, crypto, pairing, realtime, transfers, crossDevice, desktopProducer:sharedDesktopProducerService };
  onOwnerSessionInvalidated((event) => {
    let failed = false, firstError: unknown;
    const attempt = (work: () => void) => { try { work(); } catch (error) { if (!failed) firstError = error; failed = true; } };
    let deviceIds: string[] = [];
    attempt(() => { deviceIds = store.listDevices().filter(device => device.ownerBinding.ownerSessionId === event.bindingId).map(device => device.device.deviceId); });
    attempt(() => { pairing.revokeOwnerBinding(event.bindingId); });
    attempt(() => realtime.disconnectOwner(event.bindingId, deviceIds));
    attempt(() => sharedDesktopProducerService.revokeOwner(event.bindingId));
    attempt(() => crossDevice.invalidateOwnerBinding(event.bindingId));
    attempt(() => transfers.invalidateOwner(event.bindingId));
    if (failed) throw firstError;
  });
  onKillSwitchActivated(()=>{sharedDesktopProducerService.revokeAll();crossDevice.emergencyStop();for(const device of store.listDevices())transfers.invalidateOwner(device.ownerBinding.ownerSessionId);});
  return runtime;
}
