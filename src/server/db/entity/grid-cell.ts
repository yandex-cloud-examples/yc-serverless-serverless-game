import {
    withTypeOptions, snakeToCamelCaseConversion, declareType, Types, Session, TypedValues,
} from 'ydb-sdk';
import { Entity } from './entity';
import { executeQuery } from '../execute-query';
import { RectCoords } from '../../../common/types';

interface IGridCellData {
    x: number;
    y: number;
    ownerId: string;
}

@withTypeOptions({ namesConversion: snakeToCamelCaseConversion })
export class GridCell extends Entity {
    @declareType(Types.UINT32)
    public x: number;

    @declareType(Types.UINT32)
    public y: number;

    @declareType(Types.UTF8)
    public ownerId: string;

    constructor(data: IGridCellData) {
        super(data);

        this.x = data.x;
        this.y = data.y;
        this.ownerId = data.ownerId;
    }

    static async findByCoords(dbSess: Session, x: number, y: number): Promise<GridCell | undefined> {
        const query = `
            DECLARE $gridX AS Uint32;
            DECLARE $gridY AS Uint32;
            
            SELECT * FROM GridCells WHERE x = $gridX AND y = $gridY LIMIT 1;
        `;

        const { resultSets } = await executeQuery(dbSess, query, {
            $gridX: TypedValues.uint32(x),
            $gridY: TypedValues.uint32(y),
        });
        const gridCells = this.fromResultSet(resultSets[0]);

        return gridCells[0];
    }

    static async allWithinArea(dbSess: Session, area: RectCoords): Promise<GridCell[]> {
        const LIMIT = 1000;
        const result: GridCell[] = [];

        let lastX = -1;
        let lastY = -1;
        let hasMore = true;

        while (hasMore) {
            const { resultSets } = await executeQuery(dbSess, `
                DECLARE $limit AS Uint32;
                DECLARE $lastX AS Int64;
                DECLARE $lastY AS Int64;
                DECLARE $minX AS Uint32;
                DECLARE $maxX AS Uint32;
                DECLARE $minY AS Uint32;
                DECLARE $maxY AS Uint32;
                
                SELECT 
                    * 
                FROM 
                    GridCells 
                WHERE 
                    (x > $lastX OR (x == $lastX AND y > $lastY)) AND
                    x BETWEEN $minX AND $maxX AND
                    y BETWEEN $minY AND $maxY
                ORDER BY 
                    x, y 
                LIMIT 
                    $limit;
            `, {
                $limit: TypedValues.uint32(LIMIT),
                $lastX: TypedValues.int64(lastX),
                $lastY: TypedValues.int64(lastY),
                $minX: TypedValues.uint32(area[0][0]),
                $maxX: TypedValues.uint32(area[1][0]),
                $minY: TypedValues.uint32(area[0][1]),
                $maxY: TypedValues.uint32(area[1][1]),
            });

            const gridCells = this.fromResultSet(resultSets[0]);

            if (gridCells.length > 0) {
                const lastGridCell = gridCells[gridCells.length - 1];

                lastX = lastGridCell.x;
                lastY = lastGridCell.y;

                result.push(...gridCells);
            } else {
                hasMore = false;
            }
        }

        return result;
    }
}
