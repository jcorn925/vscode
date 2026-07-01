/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type SurfaceSubsystemKind = 'route' | 'component' | 'api' | 'shared';

export interface SurfaceSubsystemSpec {
	readonly id: string;
	readonly label: string;
	readonly kind: SurfaceSubsystemKind;
	readonly paths: readonly string[];
	readonly minFiles?: number;
}

export interface SurfaceBlueprintManifestSpec {
	readonly capabilities: readonly string[];
	readonly events: readonly string[];
	readonly entities: readonly string[];
	readonly ixSubsystems: readonly string[];
}

export type SurfaceBlueprintStatus = 'draft' | 'scaffolded' | 'verified' | 'failed';

export interface SurfaceBlueprint {
	readonly version: 1;
	readonly surfaceId: string;
	readonly surfaceName: string;
	readonly templateId: string;
	status: SurfaceBlueprintStatus;
	readonly subsystems: readonly SurfaceSubsystemSpec[];
	readonly manifest: SurfaceBlueprintManifestSpec;
	readonly createdAt: string;
	verifiedAt?: string;
}

export interface SurfaceBlueprintTemplate {
	readonly templateId: string;
	readonly surfaceName: string;
	readonly summary: string;
	readonly requiredSubsystems: readonly SurfaceSubsystemSpec[];
	readonly manifest: SurfaceBlueprintManifestSpec;
}

export type SurfaceBlueprintGapKind =
	| 'missing_blueprint'
	| 'invalid_blueprint'
	| 'missing_manifest_surface'
	| 'missing_manifest_field'
	| 'missing_path'
	| 'missing_scaffold_file'
	| 'ix_unavailable'
	| 'ix_no_match';

export interface SurfaceBlueprintGap {
	readonly subsystemId: string;
	readonly kind: SurfaceBlueprintGapKind;
	readonly message: string;
}

export interface SurfaceBlueprintVerificationResult {
	readonly passed: boolean;
	readonly surfaceId: string;
	readonly satisfiedCount: number;
	readonly totalCount: number;
	readonly gaps: readonly SurfaceBlueprintGap[];
	readonly ixChecked: boolean;
}
