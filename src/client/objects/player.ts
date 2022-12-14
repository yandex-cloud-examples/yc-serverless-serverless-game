import * as phaser from 'phaser';
import * as uuid from 'uuid';
import CircleMaskImage from 'phaser3-rex-plugins/plugins/circlemaskimage';
import { ConfigProvider } from '../game-config/config-provider';
import { GridCoords } from './grid/grid-coords';
import { AssetKeys } from '../assets';
import { PLAYER_MOVE_DURATION_MS } from '../constants';
import { ValueHolder } from '../../common/utils/value-holder';
import { logger } from '../../common/logger';

interface PlayerAssets {
    body: AssetKeys,
    mask: AssetKeys,
}

const PLAYER_ASSET_KEYS: Record<number, PlayerAssets> = {
    1: { body: AssetKeys.Player1, mask: AssetKeys.PlayerMask1 },
    2: { body: AssetKeys.Player2, mask: AssetKeys.PlayerMask2 },
    3: { body: AssetKeys.Player3, mask: AssetKeys.PlayerMask3 },
    4: { body: AssetKeys.Player4, mask: AssetKeys.PlayerMask4 },
};

const playersAnimationCache = new Map<AssetKeys, phaser.Animations.Animation>();
const timerAnimation: ValueHolder<phaser.Animations.Animation> = new ValueHolder();

const BODY_MASK_ALPHA = 0.6;

export class Player extends phaser.GameObjects.Container {
    private readonly bodyAssetKey: AssetKeys;
    private readonly bodyMaskAssetKey: AssetKeys;

    private readonly bodyImage: ValueHolder<phaser.Types.Physics.Arcade.SpriteWithDynamicBody> = new ValueHolder();
    private readonly bodyMaskImage: ValueHolder<phaser.Types.Physics.Arcade.ImageWithDynamicBody> = new ValueHolder();
    private readonly avatarImage: ValueHolder<CircleMaskImage> = new ValueHolder();
    private readonly timerIcon: ValueHolder<phaser.Types.Physics.Arcade.SpriteWithDynamicBody> = new ValueHolder();

    constructor(
        scene: phaser.Scene,
        colorHex: string,
        imageType: number,
        avatarUrl?: string,
        showAvatar = true,
        gridX = 0,
        gridY = 0,
    ) {
        const coords = GridCoords.getCoordsFromGridPos(gridX, gridY);

        super(scene, coords[0], coords[1]);

        this.bodyAssetKey = PLAYER_ASSET_KEYS[imageType].body;
        this.bodyMaskAssetKey = PLAYER_ASSET_KEYS[imageType].mask;

        this.initBody(colorHex);
        this.initTimerIcon();

        if (showAvatar) {
            this.initAvatar(avatarUrl);
        }

        scene.physics.systems.add.existing(this);
    }

    private initBody(colorHex: string) {
        const { playerSize } = ConfigProvider.getConfig();

        this.bodyImage.set(this.scene.physics.add.sprite(0, 0, this.bodyAssetKey, 2)
            .setDisplaySize(playerSize, playerSize));

        this.bodyMaskImage.set(this.scene.physics.add.image(0, 0, this.bodyMaskAssetKey)
            .setDisplaySize(playerSize, playerSize)
            .setTint(Number.parseInt(colorHex, 16))
            .setAlpha(BODY_MASK_ALPHA));

        this.add(this.bodyImage.get());
        this.add(this.bodyMaskImage.get());
    }

    private async initAvatar(avatarUrl?: string) {
        const { playerSize } = ConfigProvider.getConfig();
        const avatarSize = Math.round(playerSize / 1.8);
        const avatarPos: [number, number] = [
            0.8 * avatarSize,
            -0.8 * avatarSize,
        ];

        let assetKey: string = AssetKeys.DefaultAvatar;

        if (avatarUrl) {
            const randomKey = `avatar-${uuid.v4()}`;

            this.scene.load.image(randomKey, avatarUrl);

            try {
                await new Promise<void>((resolve, reject) => {
                    this.scene.load.once(phaser.Loader.Events.COMPLETE, () => {
                        this.scene.load.off(phaser.Loader.Events.FILE_LOAD_ERROR, reject);

                        resolve();
                    });
                    this.scene.load.once(phaser.Loader.Events.FILE_LOAD_ERROR, () => {
                        this.scene.load.off(phaser.Loader.Events.COMPLETE, resolve);

                        reject();
                    });

                    this.scene.load.start();
                });

                assetKey = randomKey;
            } catch {
                logger.warn(`Unable to load avatar image ${avatarUrl}, using default one instead`);
            }
        }

        this.avatarImage.set(new CircleMaskImage(this.scene, avatarPos[0], avatarPos[1], assetKey)
            .setDisplaySize(avatarSize, avatarSize));

        this.add(this.avatarImage.get());
    }

    private initTimerIcon() {
        const { playerSize } = ConfigProvider.getConfig();
        const timerIconsSize = Math.round(playerSize / 3);
        const timerPos = [
            -1.5 * timerIconsSize,
            -1.5 * timerIconsSize,
        ];

        this.timerIcon.set(this.scene.physics.add.sprite(timerPos[0], timerPos[1], AssetKeys.Timer)
            .setDisplaySize(timerIconsSize, timerIconsSize)
            .setVisible(false));

        this.add(this.timerIcon.get());
    }

    private getBodyAnimation() {
        let anim = playersAnimationCache.get(this.bodyAssetKey);

        if (!anim) {
            const newAnim = this.scene.anims.create({
                key: `${this.bodyAssetKey}-move-anim`,
                frames: this.scene.anims.generateFrameNumbers(this.bodyAssetKey, {}),
                duration: PLAYER_MOVE_DURATION_MS,
            });

            if (!newAnim) {
                throw new Error(`Unable to create animation for body asset: ${this.bodyAssetKey}`);
            }

            anim = newAnim;

            playersAnimationCache.set(this.bodyAssetKey, anim);
        }

        return anim;
    }

    private getTimerAnimation() {
        if (!timerAnimation.hasValue()) {
            const newAnim = this.scene.anims.create({
                key: 'timer-anim',
                frames: this.scene.anims.generateFrameNumbers(AssetKeys.Timer, {}),
                frameRate: 5,
                repeat: -1,
            });

            if (!newAnim) {
                throw new Error('Unable to create animation for timer');
            }

            timerAnimation.set(newAnim);
        }

        return timerAnimation.get();
    }

    private calculateMoveAngle(gridX: number, gridY: number): number {
        const currentPos = this.getGridPos();
        const xDiff = gridX - currentPos[0];
        const yDiff = gridY - currentPos[1];

        if (xDiff < 0) {
            if (yDiff < 0) {
                return 315;
            }
            if (yDiff === 0) {
                return 270;
            }
            if (yDiff > 0) {
                return 225;
            }
        }

        if (xDiff === 0) {
            if (yDiff < 0) {
                return 0;
            }
            if (yDiff > 0) {
                return 180;
            }
        }

        if (xDiff > 0) {
            if (yDiff < 0) {
                return 45;
            }
            if (yDiff === 0) {
                return 90;
            }
            if (yDiff > 0) {
                return 135;
            }
        }

        return 0;
    }

    getGridPos(): [number, number] {
        return GridCoords.getGridPosFromCoords(this.x, this.y);
    }

    moveToGridCell(gridX: number, gridY: number) {
        const coords = GridCoords.getCoordsFromGridPos(gridX, gridY);
        const angle = this.calculateMoveAngle(gridX, gridY);

        this.bodyImage.get().setAngle(angle);
        this.bodyMaskImage.get().setAngle(angle);
        this.setCapturingState(false);

        this.bodyImage.get().play(this.getBodyAnimation());

        this.scene.tweens.add({
            targets: this,
            x: coords[0],
            y: coords[1],
            duration: PLAYER_MOVE_DURATION_MS,
        });
    }

    setCapturingState(isCapturing: boolean) {
        if (isCapturing) {
            this.timerIcon.get().play(this.getTimerAnimation(), true);
        }

        this.timerIcon.get().setVisible(isCapturing);
    }
}
