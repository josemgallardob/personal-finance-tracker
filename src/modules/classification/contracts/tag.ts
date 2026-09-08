/**
 * Public tag representation of the HTTP API.
 *
 * The DTO exposes the identifier, the written name and the archival flag a
 * selector needs. It never includes a workspace identifier, a comparison key
 * or the storage timestamp that produced `isArchived`.
 */

import { type Tag, isTagActive } from "../domain/tag";

/** Tag as the API returns it. */
export interface TagDto {
  readonly id: string;
  readonly name: string;
  readonly isArchived: boolean;
}

/** Maps a domain tag to the documented HTTP representation. */
export function toTagDto(tag: Tag): TagDto {
  return {
    id: tag.id,
    name: tag.name,
    isArchived: !isTagActive(tag),
  };
}
