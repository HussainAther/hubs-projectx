import { getServerTime } from "../phoenix-adapter";

export const PX_AVATAR_ACTIONS = {
  IDLE: "idle",
  SIT: "sit",
  STAND: "stand",
  CLUB_SWAY: "dance-club-sway",
  TWO_STEP: "dance-two-step",
  SLOW_GROOVE: "dance-slow-groove",
  CHA_CHA: "dance-cha-cha",
  SPIN: "dance-spin",
  SHUFFLE: "dance-shuffle",
  DISCO_TURN: "dance-disco-turn",
  FREESTYLE: "dance-freestyle"
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
  [PX_AVATAR_ACTIONS.SPIN]: { clip: "PX_Dance_ClubSway", loop: true },
  [PX_AVATAR_ACTIONS.SHUFFLE]: { clip: "PX_Dance_TwoStep", loop: true },
  [PX_AVATAR_ACTIONS.DISCO_TURN]: { clip: "PX_Dance_ClubSway", loop: true },
  [PX_AVATAR_ACTIONS.FREESTYLE]: { clip: "PX_Dance_SlowGroove", loop: true }
};

const DANCE_ACTIONS = [
  PX_AVATAR_ACTIONS.CLUB_SWAY,
  PX_AVATAR_ACTIONS.TWO_STEP,
  PX_AVATAR_ACTIONS.SLOW_GROOVE,
  PX_AVATAR_ACTIONS.CHA_CHA,
  PX_AVATAR_ACTIONS.SPIN,
  PX_AVATAR_ACTIONS.SHUFFLE,
  PX_AVATAR_ACTIONS.DISCO_TURN,
  PX_AVATAR_ACTIONS.FREESTYLE
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
    this.baseModelRotation = null;
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
    this.baseModelRotation = this.el.object3D.rotation.clone();
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
    if (!this.modelLoaded || !this.baseModelPosition || !this.baseModelRotation) return;

    const object = this.el.object3D;

    // Root motion is visual only: the actual Hubs avatar rig stays on the navmesh.
    // This lets the dance travel and spin without breaking navigation, seating,
    // voice position, or deterministic multiplayer synchronization.
    object.position.copy(this.baseModelPosition);
    object.rotation.copy(this.baseModelRotation);

    if (action === PX_AVATAR_ACTIONS.SIT) {
      object.position.y += PX_SEATED_MODEL_OFFSET_Y;
      object.matrixNeedsUpdate = true;
      return;
    }

    const move = (x = 0, y = 0, z = 0, yaw = 0, leanX = 0, leanZ = 0) => {
      object.position.x += x;
      object.position.y += y;
      object.position.z += z;
      object.rotation.y += yaw;
      object.rotation.x += leanX;
      object.rotation.z += leanZ;
    };

    const segment = (time, start, duration) => smoothstep01((time - start) / duration);
    const pulse = (speed, phase = 0) => Math.sin(elapsed * speed + phase);
    const bounce = (speed, amount) => amount * Math.abs(Math.sin(elapsed * speed));

    if (action === PX_AVATAR_ACTIONS.CLUB_SWAY) {
      // 12-count club phrase: groove -> cross-step -> half-turn -> travelling
      // sway -> full spin -> recovery. It deliberately changes character every
      // few seconds instead of feeling like one endless sine wave.
      const t = elapsed % 12;
      let x = 0.2 * pulse(2.2);
      let z = 0.08 * pulse(4.4, Math.PI / 2);
      let yaw = 0.22 * pulse(1.2);

      if (t >= 2 && t < 4) {
        const p = segment(t, 2, 2);
        x += 0.28 * Math.sin(p * Math.PI * 2);
        z += 0.2 * Math.sin(p * Math.PI);
        yaw += 0.55 * Math.sin(p * Math.PI);
      } else if (t >= 4 && t < 6) {
        const p = segment(t, 4, 2);
        yaw += Math.PI * p;
        x += 0.18 * Math.sin(p * Math.PI);
      } else if (t >= 6 && t < 8.5) {
        const p = segment(t, 6, 2.5);
        x += 0.42 * Math.sin(p * Math.PI * 2);
        z += 0.24 * Math.sin(p * Math.PI * 4);
        yaw += 0.35 * Math.sin(p * Math.PI * 2);
      } else if (t >= 8.5 && t < 10.5) {
        const p = segment(t, 8.5, 2);
        yaw += TWO_PI * p;
        x += 0.2 * Math.sin(p * Math.PI * 2);
        z += 0.2 * Math.cos(p * Math.PI * 2) - 0.2;
      }

      move(x, bounce(6.2, 0.035), z, yaw, 0.025 * pulse(3.1), 0.045 * pulse(2.2));
    } else if (action === PX_AVATAR_ACTIONS.TWO_STEP) {
      // An 8-second travelling two-step with alternating diagonals and pivots.
      const t = elapsed % 8;
      const beat = elapsed * 4.6;
      let x = 0.26 * Math.sin(beat);
      let z = 0.11 * Math.sin(beat * 0.5 + Math.PI / 2);
      let yaw = 0.18 * Math.sin(beat * 0.5);

      if (t >= 2 && t < 4) {
        const p = segment(t, 2, 2);
        x += 0.3 * p;
        z += 0.2 * Math.sin(p * Math.PI);
        yaw += 0.45 * p;
      } else if (t >= 4 && t < 6) {
        const p = segment(t, 4, 2);
        x += 0.3 * (1 - p);
        z -= 0.26 * Math.sin(p * Math.PI);
        yaw -= 0.8 * Math.sin(p * Math.PI);
      } else if (t >= 6) {
        const p = segment(t, 6, 2);
        yaw += Math.PI * 0.5 * Math.sin(p * Math.PI);
        x += 0.2 * Math.sin(p * Math.PI * 2);
      }

      move(x, bounce(beat, 0.03), z, yaw, 0, 0.04 * Math.sin(beat));
    } else if (action === PX_AVATAR_ACTIONS.SLOW_GROOVE) {
      // Slow, weighty orbit with quarter-turns and figure-eight travel.
      const t = elapsed % 10;
      const orbit = (elapsed / 10) * TWO_PI;
      let x = 0.24 * Math.sin(orbit * 2);
      let z = 0.2 * Math.sin(orbit) * Math.cos(orbit);
      let yaw = 0.4 * pulse(0.8);

      if (t >= 3 && t < 5) yaw += (Math.PI / 2) * segment(t, 3, 2);
      if (t >= 5 && t < 7) yaw += (Math.PI / 2) * (1 - segment(t, 5, 2));
      if (t >= 7) {
        const p = segment(t, 7, 3);
        x += 0.24 * Math.sin(p * Math.PI * 2);
        z += 0.22 * Math.cos(p * Math.PI * 2) - 0.22;
      }

      move(x, 0.025 * pulse(2.4), z, yaw, 0.035 * pulse(1.1), 0.06 * pulse(1.4));
    } else if (action === PX_AVATAR_ACTIONS.CHA_CHA) {
      // 8-count cha-cha-inspired phrase: side-close-side, forward break,
      // cha-cha-cha, back break, then a turning chasse.
      const t = elapsed % 8;
      const beat = elapsed * 6;
      let x = 0;
      let z = 0;
      let yaw = 0;

      if (t < 2) {
        const p = t / 2;
        x = 0.38 * Math.sin(p * Math.PI * 2);
        yaw = 0.22 * Math.sin(p * Math.PI * 2);
      } else if (t < 4) {
        const p = (t - 2) / 2;
        z = -0.36 * Math.sin(p * Math.PI);
        x = 0.16 * Math.sin(p * Math.PI * 3);
        yaw = -0.38 * Math.sin(p * Math.PI);
      } else if (t < 6) {
        const p = (t - 4) / 2;
        z = 0.34 * Math.sin(p * Math.PI);
        x = -0.18 * Math.sin(p * Math.PI * 3);
        yaw = 0.4 * Math.sin(p * Math.PI);
      } else {
        const p = segment(t, 6, 2);
        x = 0.3 * Math.sin(p * Math.PI * 2);
        yaw = Math.PI * p;
      }

      move(x, bounce(beat, 0.04), z, yaw, 0.025 * pulse(beat), 0.05 * pulse(beat * 0.5));
    } else if (action === PX_AVATAR_ACTIONS.SPIN) {
      // Wind-up, travelling double spin, settle, reverse accent.
      const t = elapsed % 7;
      let x = 0;
      let z = 0;
      let yaw = 0;

      if (t < 1) {
        const p = segment(t, 0, 1);
        yaw = -0.45 * p;
        x = -0.12 * p;
      } else if (t < 3.8) {
        const p = segment(t, 1, 2.8);
        yaw = -0.45 + TWO_PI * 2 * p;
        x = 0.28 * Math.sin(p * TWO_PI);
        z = 0.28 * Math.cos(p * TWO_PI) - 0.28;
      } else if (t < 5.2) {
        const p = segment(t, 3.8, 1.4);
        yaw = TWO_PI * 2 - 0.45 + 0.45 * p;
        x = 0.12 * (1 - p);
      } else {
        const p = segment(t, 5.2, 1.8);
        yaw = -Math.PI * 0.75 * Math.sin(p * Math.PI);
        z = 0.18 * Math.sin(p * Math.PI);
      }

      move(x, bounce(5.8, 0.035), z, yaw, 0.02 * pulse(3), 0.055 * pulse(2.4));
    } else if (action === PX_AVATAR_ACTIONS.SHUFFLE) {
      // Running-man / shuffle-inspired visual root motion. Alternates forward
      // and back travel, diagonal cuts, then a fast half-turn reset.
      const t = elapsed % 8;
      const beat = elapsed * 7.2;
      let x = 0.16 * Math.sin(beat * 0.5);
      let z = 0.28 * Math.sin(beat);
      let yaw = 0.12 * Math.sin(beat * 0.5);

      if (t >= 2 && t < 4) {
        const p = segment(t, 2, 2);
        x += 0.36 * Math.sin(p * Math.PI);
        z *= -0.7;
        yaw += 0.45 * Math.sin(p * Math.PI);
      } else if (t >= 4 && t < 6) {
        const p = segment(t, 4, 2);
        x -= 0.36 * Math.sin(p * Math.PI);
        yaw -= 0.45 * Math.sin(p * Math.PI);
      } else if (t >= 6) {
        const p = segment(t, 6, 2);
        yaw += Math.PI * p;
        x += 0.18 * Math.sin(p * Math.PI * 2);
      }

      move(x, bounce(beat, 0.045), z, yaw, 0.015 * pulse(beat), 0.045 * pulse(beat * 0.5));
    } else if (action === PX_AVATAR_ACTIONS.DISCO_TURN) {
      // Big quarter-turn poses around a small diamond path, finishing in a
      // full disco turn. The embedded sway clip supplies arm/torso life.
      const t = elapsed % 8;
      const quarter = Math.floor(t / 1.5);
      const local = (t % 1.5) / 1.5;
      let yaw = Math.min(quarter, 3) * (Math.PI / 2);
      let x = 0;
      let z = 0;

      if (quarter < 4) {
        const radius = 0.3;
        const angle = quarter * (Math.PI / 2);
        const nextAngle = (quarter + 1) * (Math.PI / 2);
        const p = smoothstep01(local);
        x = radius * ((1 - p) * Math.sin(angle) + p * Math.sin(nextAngle));
        z = radius * ((1 - p) * Math.cos(angle) + p * Math.cos(nextAngle) - 1);
        yaw += (Math.PI / 2) * p;
      } else {
        const p = segment(t, 6, 2);
        yaw = TWO_PI * p;
        x = 0.22 * Math.sin(p * TWO_PI);
        z = 0.22 * Math.cos(p * TWO_PI) - 0.22;
      }

      move(x, bounce(5.2, 0.03), z, yaw, -0.025 * pulse(2.2), 0.07 * pulse(2.2));
    } else if (action === PX_AVATAR_ACTIONS.FREESTYLE) {
      // 16-second showcase phrase combining travel, pivots, figure-eight,
      // spins, rebound and a final wide groove. This is intentionally the
      // most theatrical option in the menu.
      const t = elapsed % 16;
      let x = 0;
      let z = 0;
      let yaw = 0;

      if (t < 3) {
        const p = t / 3;
        x = 0.42 * Math.sin(p * Math.PI * 2);
        z = 0.18 * Math.sin(p * Math.PI * 4);
        yaw = 0.45 * Math.sin(p * Math.PI * 2);
      } else if (t < 6) {
        const p = segment(t, 3, 3);
        x = 0.38 * Math.sin(p * Math.PI);
        z = -0.42 * Math.sin(p * Math.PI);
        yaw = Math.PI * p;
      } else if (t < 9) {
        const p = segment(t, 6, 3);
        x = 0.3 * Math.sin(p * TWO_PI);
        z = 0.3 * Math.cos(p * TWO_PI) - 0.3;
        yaw = Math.PI + TWO_PI * p;
      } else if (t < 12) {
        const p = segment(t, 9, 3);
        x = -0.42 * Math.sin(p * Math.PI * 2);
        z = 0.28 * Math.sin(p * Math.PI * 3);
        yaw = -Math.PI * 0.75 * Math.sin(p * Math.PI);
      } else {
        const p = segment(t, 12, 4);
        x = 0.48 * Math.sin(p * Math.PI * 2);
        z = 0.2 * Math.sin(p * Math.PI * 4);
        yaw = TWO_PI * p + 0.35 * Math.sin(p * Math.PI * 4);
      }

      move(x, bounce(5.5, 0.04), z, yaw, 0.035 * pulse(2.8), 0.07 * pulse(2.1));
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
