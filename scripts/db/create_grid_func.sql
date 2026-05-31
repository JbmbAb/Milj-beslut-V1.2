CREATE OR REPLACE FUNCTION public.get_spatial_grid_id(geom geometry)
RETURNS int AS $$
BEGIN
    RETURN (floor(ST_X(ST_Centroid(geom))/100000)*100 + floor(ST_Y(ST_Centroid(geom))/100000))::int;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
