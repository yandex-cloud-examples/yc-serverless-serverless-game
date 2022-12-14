import {
    LinearBackoff, LRUBuffer, Websocket, WebsocketBuilder,
} from 'websocket-ts';
import { Mutex } from 'async-mutex';
import { bind } from 'bind-decorator';
import { ApiClient } from './index';
import { HttpClient } from './http-client';
import { RectCoords, ServerState } from '../../common/types';
import {
    MoveRequestMessage, MoveResponseMessage,
} from '../../common/ws/messages';
import { createLogger } from '../../common/logger';
import { Channel } from './channel';
import { compressMessage, decompressMessage } from './compression';

const DEFAULT_URL = '/websocket';
const DEFAULT_WS_BACKOFF = new LinearBackoff(0, 1000, 5000);
const DEFAULT_WS_BUFFER = new LRUBuffer(5);
const logger = createLogger('WsClient');

type ServerStateListener = (newState: ServerState) => void;

export class WsClient implements ApiClient {
    private readonly ws: Websocket;
    private readonly httpClient: HttpClient;
    private readonly stateUpdateMutex = new Mutex();
    private readonly moveResponseChannel = new Channel<MoveResponseMessage>();
    private readonly stateListeners: ServerStateListener[] = [];

    private lastUpdateTime = 0;

    constructor(httpClient: HttpClient, wsUrl: string = DEFAULT_URL) {
        const currentHost = window.location.host;
        const url = new URL(wsUrl, `wss://${currentHost}`);

        this.httpClient = httpClient;
        this.ws = new WebsocketBuilder(url.toString())
            .withBackoff(DEFAULT_WS_BACKOFF)
            .withBuffer(DEFAULT_WS_BUFFER)
            .onMessage(this.onMessage)
            .build();
    }

    onNewState(listener: ServerStateListener) {
        this.stateListeners.push(listener);
    }

    private notifyStateListeners(state: ServerState) {
        if (this.stateUpdateMutex.isLocked()) {
            logger.debug('Do not notify listeners since update mutex is locked');

            return;
        }

        if (this.lastUpdateTime >= state.time) {
            logger.debug('Do not notify listeners since new state has old update time', this.lastUpdateTime, state.time);

            return;
        }

        this.lastUpdateTime = state.time;

        for (const l of this.stateListeners) {
            l(state);
        }
    }

    @bind
    private async onMessage(ws: Websocket, event: MessageEvent) {
        if (!(event.data instanceof Blob)) {
            logger.warn('Incoming data is not Blob', event);

            return;
        }

        const message = await decompressMessage(event.data);

        logger.debug('Got message from websocket', message);

        if (!message) {
            logger.warn('WS message is empty after decompressing');

            return;
        }

        switch (message.type) {
            case 'state-update':
                this.notifyStateListeners(message.payload);
                break;

            case 'move-response':
                this.moveResponseChannel.send(message);
                break;

            default:
                logger.warn('Unknown WS message', message);
        }
    }

    async moveTo(gridX: number, gridY: number, fov: RectCoords) {
        const moveRequest = [gridX, gridY];

        logger.debug('Received moveTo request, waiting for mutex', moveRequest, fov);

        let moveResponse: MoveResponseMessage | undefined;

        await this.stateUpdateMutex.runExclusive(async () => {
            logger.debug('Mutex acquired, performing request to server', moveRequest);

            const message: MoveRequestMessage = {
                type: 'move-request',
                payload: {
                    gridX,
                    gridY,
                    fov,
                },
            };

            const compressedMessage = await compressMessage(message);

            this.ws.send(compressedMessage);

            try {
                logger.debug('Waiting for move response', moveRequest);

                moveResponse = await this.moveResponseChannel.receive();

                logger.debug('Received move response', moveResponse);
            } catch (error) {
                logger.warn('Unable to get move response', error);
            }
        });

        if (moveResponse) {
            this.notifyStateListeners(moveResponse.payload);
        }
    }

    async getConfig() {
        return this.httpClient.getConfig();
    }

    async getState(withStats = false) {
        return this.httpClient.getState(withStats);
    }
}
