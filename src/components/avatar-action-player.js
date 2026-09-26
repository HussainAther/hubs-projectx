import { getServerTime } from "../phoenix-adapter";

export const PX_AVATAR_ACTIONS = {
  IDLE: "idle",
  SIT: "sit",
  STAND: "stand",
  CLUB_SWAY: "dance-club-sway",
  TWO_STEP: "dance-two-step",
  SLOW_GROOVE: "dance-slow-groove",
  CHA_CHA: "dance-cha-cha",
  SPIN: "dance-spin"
};

const ACTION_CLIPS = {
  [PX_AVATAR_ACTIONS.IDLE]: { clip: "PX_Avatar_Idle_Loop", loop: true },
  [PX_AVATAR_ACTIONS.SIT]: { clip: "PX_Sit", enterClip: "PX_Sit_Enter", enterDuration: 0.8, loop: true },
  [PX_AVATAR_ACTIONS.STAND]: { clip: "PX_Stand", duration: 0.8, loop: false },
  [PX_AVATAR_ACTIONS.CLUB_SWAY]: { clip: "PX_Dance_ClubSway", loop: true },
  [PX_AVATAR_ACTIONS.TWO_STEP]: { clip: "PX_Dance_TwoStep", loop: true },
  [PX_AVATAR_ACTIONS.SLOW_GROOVE]: { clip: "PX_Dance_SlowGroove", loop: true },
  // The avatar GLB currently has three embedded dance clips. These two
  // expanded actions reuse the closest clip and add synchronized procedural
  // body translation / rotation on top of it.
  [PX_AVATAR_ACTIONS.CHA_CHA]: { clip: "PX_Dance_TwoStep", loop: true },
  [PX_AVATAR_ACTIONS.SPIN]: { clip: "PX_Dance_ClubSway", loop: true }
};

const DANCE_ACTIONS = [
  PX_AVATAR_ACTIONS.CLUB_SWAY,
  PX_AVATAR_ACTIONS.TWO_STEP,
  PX_AVATAR_ACTIONS.SLOW_GROOVE,
  PX_AVATAR_ACTIONS.CHA_CHA,
  PX_AVATAR_ACTIONS.SPIN
];

const TWO_PI = Math.PI * 2;

// Visual-only model offset while seated. The waypoint, camera, and networked
// avatar rig remain at their existing positions; only the rendered avatar body
// is lowered into the chair.
const PX_SEATED_MODEL_OFFSET_Y = -0.28;

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
      const pov = document.getElementById("avatar-pov-node");
      const forward = pov
        ? pov.object3D.getWorldDirection(new THREE.Vector3()).setY(0).normalize()
        : new THREE.Vector3(0, 0, -1);
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
  if (!DANCE_ACTIONS.includes(action)) {
    return setLocalAvatarAction(PX_AVATAR_ACTIONS.IDLE);
  }
  if (localSeatWaypoint || getLocalAvatarAction() === PX_AVATAR_ACTIONS.SIT) leaveLocalSeat(false);
  return setLocalAvatarAction(action);
}

function isProjectXSeat(waypoint) {
  return waypoint?.el?.object3D?.name?.startsWith("PX_Seat_");
}

function smoothstep01(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

AFRAME.registerComponent("avatar-action-player", {
  init() {
    this.rigEl = this.el.parentNode;
    this.currentAction = null;
    this.currentTimer = null;
    this.baseModelPosition = null;
    this.baseModelRotationY = 0;
    this.modelLoaded = false;
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
    this.baseModelPosition = this.el.object3D.position.clone();
    this.baseModelRotationY = this.el.object3D.rotation.y;
    this.modelLoaded = true;
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

  applyProceduralMotion(action, elapsed) {
    if (!this.modelLoaded || !this.baseModelPosition) return;

    const object = this.el.object3D;

    // Reset before applying the current frame so procedural motion cannot drift.
    object.position.copy(this.baseModelPosition);
    object.rotation.y = this.baseModelRotationY;

    if (action === PX_AVATAR_ACTIONS.SIT) {
      object.position.y += PX_SEATED_MODEL_OFFSET_Y;
      object.matrixNeedsUpdate = true;
      return;
    }

    if (action === PX_AVATAR_ACTIONS.CLUB_SWAY) {
      const cycle = elapsed % 8.0;
      const spin = smoothstep01((cycle - 5.2) / 1.5);

      object.position.x += 0.22 * Math.sin(elapsed * 2.4);
      object.position.z += 0.1 * Math.sin(elapsed * 4.8);
      object.position.y += 0.035 * Math.sin(elapsed * 6.0);
      object.rotation.y += 0.35 * Math.sin(elapsed * 1.5) + TWO_PI * spin;
    } else if (action === PX_AVATAR_ACTIONS.TWO_STEP) {
      const beat = elapsed * 4.2;

      object.position.x += 0.24 * Math.sin(beat);
      object.position.z += 0.15 * Math.sin(beat * 0.5 + Math.PI / 2);
      object.position.y += 0.025 * Math.abs(Math.sin(beat));
      object.rotation.y += 0.28 * Math.sin(beat * 0.5);
    } else if (action === PX_AVATAR_ACTIONS.SLOW_GROOVE) {
      object.position.x += 0.17 * Math.sin(elapsed * 1.7);
      object.position.z += 0.17 * Math.cos(elapsed * 1.7);
      object.position.y += 0.025 * Math.sin(elapsed * 3.4);
      object.rotation.y += 0.48 * Math.sin(elapsed * 1.1);
    } else if (action === PX_AVATAR_ACTIONS.CHA_CHA) {
      const beat = elapsed * 5.4;
      const quickQuickSlow = Math.sin(beat) + 0.45 * Math.sin(beat * 2.0);

      object.position.x += 0.27 * quickQuickSlow;
      object.position.z += 0.18 * Math.sin(beat * 0.5 + Math.PI / 3);
      object.position.y += 0.035 * Math.abs(Math.sin(beat * 1.5));
      object.rotation.y += 0.42 * Math.sin(beat * 0.5);
    } else if (action === PX_AVATAR_ACTIONS.SPIN) {
      const spinCycle = elapsed % 4.0;
      const spin = smoothstep01((spinCycle - 0.35) / 2.7);

      object.position.x += 0.12 * Math.sin(elapsed * 2.0);
      object.position.z += 0.12 * Math.cos(elapsed * 2.0);
      object.position.y += 0.03 * Math.abs(Math.sin(elapsed * 4.0));
      object.rotation.y += TWO_PI * spin;
    }

    object.matrixNeedsUpdate = true;
  },

  tick() {
    if (!this.modelLoaded) return;

    const data = this.rigEl.components["networked-avatar"]?.data;
    if (!data) return;

    const action = ACTION_CLIPS[data.px_action] ? data.px_action : PX_AVATAR_ACTIONS.IDLE;
    const elapsed = Math.max(0, (getServerTime() - (data.px_action_started_at || getServerTime())) / 1000);
    this.applyProceduralMotion(action, elapsed);
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
