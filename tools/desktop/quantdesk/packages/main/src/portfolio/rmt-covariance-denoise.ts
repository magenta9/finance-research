import { EigenvalueDecomposition, Matrix } from 'ml-matrix';

import { correlationMatrix } from './statistics';

const rebuildCovariance = (correlation: number[][], variances: number[]) => correlation.map((row, rowIndex) => (
    row.map((value, columnIndex) => (
        value * Math.sqrt(Math.max(variances[rowIndex] ?? 0, 0) * Math.max(variances[columnIndex] ?? 0, 0))
    ))
));

export const denoiseCovarianceMarchenkoPastur = (
    covariance: number[][],
    observationCount: number,
) => {
    const assetCount = covariance.length;

    if (assetCount <= 1 || observationCount <= assetCount) {
        return covariance.map((row) => [...row]);
    }

    const ratio = assetCount / observationCount;
    const maxEigenvalue = (1 + Math.sqrt(ratio)) ** 2;
    const variances = covariance.map((row, index) => Math.max(row[index] ?? 0, 0));
    const correlation = correlationMatrix(covariance);
    const decomposition = new EigenvalueDecomposition(new Matrix(correlation));
    const eigenvalues = decomposition.realEigenvalues;
    const eigenvectors = decomposition.eigenvectorMatrix;
    const noiseValues = eigenvalues.filter((value) => value <= maxEigenvalue);
    const noiseAverage = noiseValues.length > 0
        ? noiseValues.reduce((sum, value) => sum + value, 0) / noiseValues.length
        : 0;
    const denoisedEigenvalues = eigenvalues.map((value) => (
        value <= maxEigenvalue ? noiseAverage : value
    ));
    const denoisedDiagonal = Matrix.diag(denoisedEigenvalues);
    const denoisedCorrelationMatrix = eigenvectors
        .mmul(denoisedDiagonal)
        .mmul(eigenvectors.transpose());

    return rebuildCovariance(denoisedCorrelationMatrix.to2DArray(), variances);
};
