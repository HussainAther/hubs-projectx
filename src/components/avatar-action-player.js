import { getServerTime } from "../phoenix-adapter";

export const PX_AVATAR_ACTIONS = {
  IDLE: "idle",
  SIT: "sit",
  STAND: "stand",
  CLUB_SWAY: "dance-club-sway",
  TWO_STEP: "dance-two-step",
  SLOW_GROOVE: "dance-slow-groove"
};

const ACTION_CLIPS = {
  [PX_AVATAR_ACTIONS.IDLE]: { clip: "PX_Avatar_Idle_Loop", loop: true },
  [PX_AVATAR_ACTIONS.SIT]: { clip: "PX_Sit", enterClip: "PX_Sit_Enter", enterDuration: 0.8, loop: true },
  [PX_AVATAR_ACTIONS.STAND]: { clip: "PX_Stand", duration: 0.8, loop: false },
  [PX_AVATAR_ACTIONS.CLUB_SWAY]: { clip: "PX_Dance_ClubSway", loop: true },
  [PX_AVATAR_ACTIONS.TWO_STEP]: { clip: "PX_Dance_TwoStep", loop: true },
  [PX_AVATAR_ACTIONS.SLOW_GROOVE]: { clip: "PX_Dance_SlowGroove", loop: true }
};

let localSeatWaypoint = null;
let standTimer = null;

function networkedAvatarData() {
  const rig = document.getElementById("avatar-rig");
  return rig && rig.components["networked-avatar"] && rig.components["networked-avatar"].data;
}

export function getLocalAvatarAction() {
  return networkedAvatarData()?.px_action || PX_AVATAR_ACTIONS.IDLE;
}

function writeLocalAvatarAction(action) {
  const rig = document.getElementById("avatar-rig");
  if (!rig || !rig.components["networked-avatar"] || !ACTION_CLIPS[action]) return false;
  rig.setAttribute("networked-avatar", {
    px_action: action,
    px_action_started_at: getServerTime()
  });
  rig.emit("px-avatar-action-changed", { action });
  return true;
}

function setLocalCameraHeight(height) {
  const pov = document.getElementById("avatar-pov-node");
  if (pov) {
    pov.object3D.position.y = height;
    pov.object3D.matrixNeedsUpdate = true;
  }
}

export function leaveLocalSeat(playStand = true) {
  if (!localSeatWaypoint && getLocalAvatarAction() !== PX_AVATAR_ACTIONS.SIT) {
    if (playStand) writeLocalAvatarAction(PX_AVATAR_ACTIONS.IDLE);
    return;
  }
  const scene = AFRAME.scenes[0];
  const characterController = scene?.systems["hubs-systems"]?.characterController;
  const waypointSystem = scene?.systems["hubs-systems"]?.waypointSystem;
  const seat = localSeatWaypoint;
  localSeatWaypoint = null;
  if (waypointSystem) waypointSystem.releaseAnyOccupiedWaypoints();
  setLocalCameraHeight(1.6);
  if (characterController) {
    characterController.isMotionDisabled = false;
    characterController.isTeleportingDisabled = false;
    if (seat) {
      const target = seat.el.object3D.getWorldPosition(new THREE.Vector3());
      const forward = document
        .getElementById("avatar-pov-node")
        .object3D.getWorldDirection(new THREE.Vector3())
        .setY(0)
        .normalize();
      target.addScaledVector(forward, 0.75);
      characterController.teleportTo(target);
    }
  }
  if (standTimer) clearTimeout(standTimer);
  if (playStand) {
    writeLocalAvatarAction(PX_AVATAR_ACTIONS.STAND);
    standTimer = setTimeout(() => {
      const data = networkedAvatarData();
      if (data?.px_action === PX_AVATAR_ACTIONS.STAND) writeLocalAvatarAction(PX_AVATAR_ACTIONS.IDLE);
    }, 800);
  }
}

export function setLocalAvatarAction(action) {
  if (action !== PX_AVATAR_ACTIONS.SIT && localSeatWaypoint) leaveLocalSeat(false);
  return writeLocalAvatarAction(action);
}

function enterLocalSeat(waypoint) {
  if (!waypoint) return;
  localSeatWaypoint = waypoint;
  setLocalCameraHeight(1.15);
  setLocalAvatarAction(PX_AVATAR_ACTIONS.SIT);
}

export function selectLocalDance(action) {
  if (![PX_AVATAR_ACTIONS.CLUB_SWAY, PX_AVATAR_ACTIONS.TWO_STEP, PX_AVATAR_ACTIONS.SLOW_GROOVE].includes(action)) {
    return setLocalAvatarAction(PX_AVATAR_ACTIONS.IDLE);
  }
  if (localSeatWaypoint || getLocalAvatarAction() === PX_AVATAR_ACTIONS.SIT) leaveLocalSeat(false);
  return setLocalAvatarAction(action);
}

function isProjectXSeat(waypoint) {
  return waypoint?.el?.object3D?.name?.startsWith("PX_Seat_");
}

AFRAME.registerComponent("avatar-action-player", {
  init() {
    this.rigEl = this.el.parentNode;
    this.currentAction = null;
    this.currentTimer = null;
    this.onModelLoaded = this.onModelLoaded.bind(this);
    this.onRigChanged = this.onRigChanged.bind(this);
    this.onSeatEntered = this.onSeatEntered.bind(this);
    this.el.addEventListener("model-loaded", this.onModelLoaded);
    this.rigEl.addEventListener("componentchanged", this.onRigChanged);
    if (this.rigEl.id === "avatar-rig") {
      this.el.sceneEl.addEventListener("px-seat-selected", this.onSeatEntered);
    }
  },

  remove() {
    this.el.removeEventListener("model-loaded", this.onModelLoaded);
    this.rigEl.removeEventListener("componentchanged", this.onRigChanged);
    this.el.sceneEl.removeEventListener("px-seat-selected", this.onSeatEntered);
    if (this.currentTimer) clearTimeout(this.currentTimer);
    if (this.currentAction) this.currentAction.stop();
  },

  onModelLoaded() {
    this.applyNetworkedAction();
  },

  onRigChanged(event) {
    if (event.detail.name === "networked-avatar") this.applyNetworkedAction();
  },

  onSeatEntered(event) {
    if (isProjectXSeat(event.detail.waypoint)) enterLocalSeat(event.detail.waypoint);
  },

  mixerData() {
    const component = this.el.components["animation-mixer"];
    return component?.mixer && component?.animations ? component : null;
  },

  clip(name) {
    return this.mixerData()?.animations.find(clip => clip.name === name);
  },

  playClip(name, loop, offset = 0) {
    const mixerData = this.mixerData();
    const clip = this.clip(name);
    if (!mixerData || !clip) {
      console.warn(`Project X avatar clip '${name}' is unavailable on the current avatar.`);
      return false;
    }
    const next = mixerData.mixer.clipAction(clip, this.el.object3D);
    if (this.currentAction && this.currentAction !== next) {
      this.currentAction.fadeOut(0.15);
    }
    next.reset();
    next.enabled = true;
    next.clampWhenFinished = !loop;
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.time = loop && clip.duration ? offset % clip.duration : Math.min(offset, clip.duration);
    next.fadeIn(0.15).play();
    this.currentAction = next;
    return true;
  },

  applyNetworkedAction() {
    const mixerData = this.mixerData();
    const data = this.rigEl.components["networked-avatar"]?.data;
    if (!mixerData || !data) return;
    if (this.currentTimer) {
      clearTimeout(this.currentTimer);
      this.currentTimer = null;
    }
    const action = ACTION_CLIPS[data.px_action] ? data.px_action : PX_AVATAR_ACTIONS.IDLE;
    const config = ACTION_CLIPS[action];
    const elapsed = Math.max(0, (getServerTime() - (data.px_action_started_at || getServerTime())) / 1000);
    if (config.enterClip && elapsed < config.enterDuration) {
      this.playClip(config.enterClip, false, elapsed);
      this.currentTimer = setTimeout(
        () => {
          this.playClip(config.clip, true, 0);
        },
        Math.max(0, (config.enterDuration - elapsed) * 1000)
      );
      return;
    }
    const offset = config.enterClip ? Math.max(0, elapsed - config.enterDuration) : elapsed;
    this.playClip(config.clip, config.loop, offset);
  }
});
