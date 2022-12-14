import * as cookie from 'cookie';
import { Handler } from '@yandex-cloud/function-types';
import * as uuid from 'uuid';
import { withDb } from '../../db/with-db';
import { AUTH_COOKIE_MAX_AGE, AUTH_COOKIE_NAME, PLAYER_IMAGE_TYPES_NUM } from '../../utils/constants';
import { functionResponse } from '../../utils/function-response';
import { getAuthHash, pickAuthParameters } from '../../utils/tg-auth';
import { User } from '../../db/entity/user';
import { UserState } from '../../../common/types';
import { getGameConfig } from '../../utils/get-game-config';
import { executeQuery } from '../../db/execute-query';
import { isPlayerActive } from '../../utils/is-player-active';
import { notifyStateChange } from '../../utils/notify-state-change';
import { getRandomColor } from '../../utils/get-random-color';

const TG_CDN_PREFIX = 'https://t.me/i/userpic';

const transformAvatarUrl = (originalUrl: string): string | undefined => {
    let result: string | undefined;

    if (originalUrl.startsWith(TG_CDN_PREFIX)) {
        result = originalUrl.replace(TG_CDN_PREFIX, '/proxy/tg-avatars');
    }

    return result;
};

export const handler = withDb<Handler.Http>(async (dbSess, event, context) => {
    const authParameters = pickAuthParameters(event.queryStringParameters);
    const checkHash = await getAuthHash(authParameters);

    if (checkHash !== authParameters.hash) {
        return functionResponse({
            error: 'Bad parameters',
        }, 400);
    }

    const gameConfig = await getGameConfig(dbSess);
    const users = await User.all(dbSess);
    const online = users.filter((u) => isPlayerActive(gameConfig, u)).length;

    let user = users.find((u) => u.tgUserId === authParameters.id);

    if (online >= gameConfig.maxActivePlayers) {
        return {
            statusCode: 302,
            headers: {
                Location: `/limit.html?limit=${gameConfig.maxActivePlayers}`,
            },
        };
    }

    if (!user) {
        const existingColors = users.map((u) => u.color);
        const randomColor = getRandomColor(existingColors);
        const login = authParameters.username ? `@${authParameters.username}` : `${authParameters.first_name}${authParameters.last_name}`;
        const tgAvatar = authParameters.photo_url && transformAvatarUrl(authParameters.photo_url);
        const imageType = Math.floor(Math.random() * PLAYER_IMAGE_TYPES_NUM + 1);

        user = new User({
            id: uuid.v4(),
            color: randomColor,
            gridX: Math.floor(Math.random() * gameConfig.worldGridSize[0]),
            gridY: Math.floor(Math.random() * gameConfig.worldGridSize[0]),
            tgAvatar,
            lastActive: new Date(),
            state: UserState.DEFAULT,
            tgUsername: login,
            tgUserId: authParameters.id,
            imageType,
            cellsCount: 0,
        });

        const createUserQuery = `
            DECLARE $id AS UTF8;
            DECLARE $cellsCount AS UINT32;
            DECLARE $color AS UTF8;
            DECLARE $gridX AS UINT32;
            DECLARE $gridY AS UINT32;
            DECLARE $tgAvatar AS UTF8?;
            DECLARE $lastActive AS TIMESTAMP;
            DECLARE $state AS UTF8;
            DECLARE $tgUsername AS UTF8;
            DECLARE $tgUserId AS UTF8;
            DECLARE $imageType AS UINT8;
            INSERT INTO Users (id, cells_count, color, grid_x, grid_y, last_active, state, tg_avatar, tg_user_id, tg_username, image_type)
            VALUES ($id, $cellsCount, $color, $gridX, $gridY, $lastActive, $state, $tgAvatar, $tgUserId, $tgUsername, $imageType);
        `;

        await executeQuery(dbSess, createUserQuery, {
            $id: user.getTypedValue('id'),
            $color: user.getTypedValue('color'),
            $gridX: user.getTypedValue('gridX'),
            $gridY: user.getTypedValue('gridY'),
            $tgAvatar: user.getTypedValue('tgAvatar'),
            $lastActive: user.getTypedValue('lastActive'),
            $state: user.getTypedValue('state'),
            $tgUsername: user.getTypedValue('tgUsername'),
            $tgUserId: user.getTypedValue('tgUserId'),
            $imageType: user.getTypedValue('imageType'),
            $cellsCount: user.getTypedValue('cellsCount'),
        });
    }

    await notifyStateChange('login', [user.gridX, user.gridY]);

    const hostHeader = event.headers.Host;
    const autCookie = cookie.serialize(AUTH_COOKIE_NAME, JSON.stringify(authParameters), {
        path: '/',
        domain: hostHeader || undefined,
        maxAge: AUTH_COOKIE_MAX_AGE,
        httpOnly: true,
        secure: true,
    });

    return {
        statusCode: 302,
        headers: {
            'Set-Cookie': autCookie,
            Location: '/',
        },
    };
});
