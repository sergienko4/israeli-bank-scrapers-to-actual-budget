/**
 * ExpoPushNotifierFactory — registered with NotifierRegistry. Adds a mobile-push
 * notifier only when at least one device has registered, so users who do not use
 * the app get no extra channel. Device tokens live in their own file (written by
 * the portal), not in config.json, so `applies` consults the store, not config.
 */
import type { INotificationConfig } from '../../Types/Index.js';
import DeviceTokenStore from './DeviceTokenStore.js';
import ExpoPushNotifier from './ExpoPushNotifier.js';
import type { INotifier } from './INotifier.js';
import type { INotifierFactory } from './INotifierFactory.js';

const EXPO_PUSH_NOTIFIER_FACTORY: INotifierFactory = {
  name: 'expoPush',
  /**
   * Applies when at least one device has registered for push.
   * @param _config - Notification config (unused; devices live in their own file).
   * @returns True when there is a registered device.
   */
  applies(_config: INotificationConfig): boolean {
    const store = new DeviceTokenStore();
    const tokens = store.list();
    return tokens.length > 0;
  },
  /**
   * Builds the ExpoPushNotifier. Caller must have checked {@link applies}.
   * @param _config - Notification config (unused).
   * @returns A new ExpoPushNotifier.
   */
  create(_config: INotificationConfig): INotifier {
    return new ExpoPushNotifier();
  },
  /**
   * Returns the log line printed when this notifier is registered.
   * @param _config - Notification config (unused).
   * @returns Stable status string for logger.info().
   */
  describe(_config: INotificationConfig): string {
    return '📱 Mobile push notifications enabled';
  },
};

export default EXPO_PUSH_NOTIFIER_FACTORY;
