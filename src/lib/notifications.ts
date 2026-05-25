import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

const ensureNotificationPermission = async () => {
  if (await isPermissionGranted()) {
    return true;
  }

  const permission = await requestPermission();
  return permission === "granted";
};

export const sendCompletionNotification = async (
  title: string,
  body: string,
) => {
  try {
    if (!(await ensureNotificationPermission())) {
      return;
    }

    sendNotification({ title, body });
  } catch (error) {
    console.warn("Failed to send completion notification:", error);
  }
};
