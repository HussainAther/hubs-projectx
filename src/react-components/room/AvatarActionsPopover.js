import React, { useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { defineMessage, FormattedMessage, useIntl } from "react-intl";
import { ToolTip } from "@mozilla/lilypad-ui";
import { Popover } from "../popover/Popover";
import { ToolbarButton } from "../input/ToolbarButton";
import { Button } from "../input/Button";
import { Column } from "../layout/Column";
import { ReactComponent as ReactionIcon } from "../icons/Reaction.svg";
import {
  PX_AVATAR_ACTIONS,
  getLocalAvatarAction,
  leaveLocalSeat,
  selectLocalDance
} from "../../components/avatar-action-player";

const avatarActionsTooltip = defineMessage({
  id: "px-avatar-actions.tooltip",
  defaultMessage: "Dance, pose, or stand"
});

function AvatarActionsContent({ action, onSelect, onStand }) {
  const isSeated = action === PX_AVATAR_ACTIONS.SIT || action === PX_AVATAR_ACTIONS.STAND;
  return (
    <Column padding="sm" gap="sm">
      {isSeated && (
        <Button preset="accept" onClick={onStand}>
          <FormattedMessage id="px-avatar-actions.stand" defaultMessage="Stand" />
        </Button>
      )}
      <Button
        preset={action === PX_AVATAR_ACTIONS.CLUB_SWAY ? "accent2" : "basic"}
        onClick={() => onSelect(PX_AVATAR_ACTIONS.CLUB_SWAY)}
      >
        <FormattedMessage id="px-avatar-actions.club-sway" defaultMessage="Club Sway + Spin" />
      </Button>
      <Button
        preset={action === PX_AVATAR_ACTIONS.TWO_STEP ? "accent2" : "basic"}
        onClick={() => onSelect(PX_AVATAR_ACTIONS.TWO_STEP)}
      >
        <FormattedMessage id="px-avatar-actions.two-step" defaultMessage="Dynamic Two-Step" />
      </Button>
      <Button
        preset={action === PX_AVATAR_ACTIONS.CHA_CHA ? "accent2" : "basic"}
        onClick={() => onSelect(PX_AVATAR_ACTIONS.CHA_CHA)}
      >
        <FormattedMessage id="px-avatar-actions.cha-cha" defaultMessage="Cha-Cha" />
      </Button>
      <Button
        preset={action === PX_AVATAR_ACTIONS.SPIN ? "accent2" : "basic"}
        onClick={() => onSelect(PX_AVATAR_ACTIONS.SPIN)}
      >
        <FormattedMessage id="px-avatar-actions.spin" defaultMessage="Spin" />
      </Button>
      <Button
        preset={action === PX_AVATAR_ACTIONS.SLOW_GROOVE ? "accent2" : "basic"}
        onClick={() => onSelect(PX_AVATAR_ACTIONS.SLOW_GROOVE)}
      >
        <FormattedMessage id="px-avatar-actions.slow-groove" defaultMessage="Wide Slow Groove" />
      </Button>
      <Button preset="basic" onClick={() => onSelect(PX_AVATAR_ACTIONS.IDLE)}>
        <FormattedMessage id="px-avatar-actions.stop" defaultMessage="Stop Dance / Return to Idle" />
      </Button>
    </Column>
  );
}

AvatarActionsContent.propTypes = {
  action: PropTypes.string.isRequired,
  onSelect: PropTypes.func.isRequired,
  onStand: PropTypes.func.isRequired
};

export function AvatarActionsPopoverButton() {
  const intl = useIntl();
  const [visible, setVisible] = useState(false);
  const [action, setAction] = useState(getLocalAvatarAction());
  const popoverApiRef = useRef();

  useEffect(() => {
    const rig = document.getElementById("avatar-rig");
    if (!rig) return undefined;
    const update = event => {
      if (event.detail.name === "networked-avatar") setAction(getLocalAvatarAction());
    };
    rig.addEventListener("componentchanged", update);
    return () => rig.removeEventListener("componentchanged", update);
  }, []);

  const onSelect = useCallback(nextAction => {
    selectLocalDance(nextAction);
    setAction(nextAction);
    setVisible(false);
  }, []);

  const onStand = useCallback(() => {
    leaveLocalSeat(true);
    setAction(PX_AVATAR_ACTIONS.STAND);
    setVisible(false);
  }, []);

  return (
    <Popover
      title={<FormattedMessage id="px-avatar-actions.title" defaultMessage="Dance / Poses" />}
      content={() => <AvatarActionsContent action={action} onSelect={onSelect} onStand={onStand} />}
      placement="top"
      offsetDistance={28}
      popoverApiRef={popoverApiRef}
      isVisible={visible}
      onChangeVisible={setVisible}
    >
      {({ togglePopover, popoverVisible, triggerRef }) => (
        <ToolTip description={intl.formatMessage(avatarActionsTooltip)}>
          <ToolbarButton
            ref={triggerRef}
            icon={<ReactionIcon />}
            label={<FormattedMessage id="px-avatar-actions.toolbar" defaultMessage="Dance" />}
            preset="accent2"
            selected={popoverVisible}
            onClick={togglePopover}
          />
        </ToolTip>
      )}
    </Popover>
  );
}
